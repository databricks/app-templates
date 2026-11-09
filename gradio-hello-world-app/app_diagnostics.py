"""Crash / hang / exception diagnostics for Databricks Apps (stdlib-only).

Databricks Apps run in locked-down pods where you cannot install debuggers
(pyspy / gdb / strace need ptrace / CAP_SYS_PTRACE, which are blocked). The only
reliable diagnostics channel is the app's log stream (`databricks apps logs`,
plain stdout/stderr). This module wires Python's standard library so that when an
app crashes, hangs, or hits an unhandled exception, a usable stack trace lands in
that stream.

Call ``install_diagnostics()`` as early as possible in your entrypoint (before
importing framework/app code), e.g. at the top of ``app.py`` /
``agent_server/start_server.py``. It is idempotent, import-safe, framework-
agnostic, and never raises into the host app.

What it installs (all to stderr):
  * faulthandler for fatal faults (segfault / abort) — all threads.
  * SIGUSR1 handler for an on-demand all-thread dump (`kill -USR1 <pid>`).
  * sys.excepthook / threading.excepthook to log unhandled exceptions.
  * a chained SIGTERM handler that dumps all thread stacks on shutdown/kill —
    this is what reveals where a *hung* app was stuck when the platform kills it.
  * (opt-in) a periodic all-thread "hang watchdog" via
    DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT.

Environment toggles (read at install time):
  DATABRICKS_APP_DIAGNOSTICS        "0"/"false" disables everything (kill switch).
  DATABRICKS_APP_DIAGNOSTICS_LOG_LEVEL   diagnostics log level (default INFO).
  DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT  seconds; enables the periodic hang dump.

Logging note: diagnostics records go to a dedicated ``app.diagnostics`` logger with
its own stderr handler (propagation off); this module does NOT install a root
handler, so a later ``logging.basicConfig()`` in the app behaves normally.
"""
from __future__ import annotations

import faulthandler
import logging
import os
import signal
import sys
import threading

# Process-level install guard. Set on `sys` (a per-interpreter singleton) rather
# than a module global, so importing this file under two names in one process
# (e.g. `scripts.app_diagnostics` and `app_diagnostics`) can't double-install the
# hooks/handlers. Not an env var — that would be inherited by child processes.
_SENTINEL_ATTR = "_app_diagnostics_installed"
_LOGGER_NAME = "app.diagnostics"
_LOG_FORMAT = "%(asctime)s %(levelname)s [%(process)d:%(threadName)s] %(name)s: %(message)s"
# Keep a reference to the stream faulthandler writes to so it is not GC'd.
_fault_stream = sys.stderr


def _is_disabled() -> bool:
    return os.environ.get("DATABRICKS_APP_DIAGNOSTICS", "").strip().lower() in {"0", "false", "no", "off"}


def _on_main_thread() -> bool:
    return threading.current_thread() is threading.main_thread()


def _setup_logging() -> logging.Logger:
    """Route diagnostics records to stderr via a dedicated logger.

    We attach our stderr handler to the ``app.diagnostics`` logger (NOT the root
    logger) with propagation off, so crash/exception records always reach the Apps
    log stream without taking over root logging. install_diagnostics() runs before
    the app configures logging; adding a root handler here would make a later
    ``logging.basicConfig()`` in the app a silent no-op (basicConfig does nothing
    once the root logger has a handler), overriding the app's level/format.
    """
    level_name = os.environ.get("DATABRICKS_APP_DIAGNOSTICS_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger = logging.getLogger(_LOGGER_NAME)
    if not any(getattr(h, "_app_diagnostics", False) for h in logger.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT))
        handler._app_diagnostics = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False  # our records go to our own handler, not through root
    return logger


def _install_excepthooks(logger: logging.Logger) -> None:
    prev_excepthook = sys.excepthook

    def excepthook(exc_type, exc_value, exc_tb):
        if issubclass(exc_type, KeyboardInterrupt):
            prev_excepthook(exc_type, exc_value, exc_tb)
            return
        logger.critical("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
        prev_excepthook(exc_type, exc_value, exc_tb)

    sys.excepthook = excepthook

    prev_threadhook = getattr(threading, "excepthook", None)

    def threadhook(args):
        if not issubclass(args.exc_type, SystemExit):
            logger.critical(
                "Unhandled exception in thread %s",
                args.thread.name if args.thread else "?",
                exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
            )
        if callable(prev_threadhook):
            prev_threadhook(args)

    if hasattr(threading, "excepthook"):
        threading.excepthook = threadhook


def _install_signal_handlers(logger: logging.Logger) -> None:
    """SIGTERM all-thread dump (chained) + on-demand SIGUSR1 dump. Main thread only."""
    if not _on_main_thread():
        logger.info("diagnostics: not on main thread; skipping signal handlers")
        return

    if hasattr(signal, "SIGTERM"):
        prev_term = signal.getsignal(signal.SIGTERM)

        def term_handler(signum, frame):
            logger.warning("received SIGTERM — dumping all thread stacks before shutdown")
            faulthandler.dump_traceback(file=sys.stderr, all_threads=True)
            if callable(prev_term):
                prev_term(signum, frame)
            else:
                # No prior handler (SIG_DFL/SIG_IGN): exit with the conventional code.
                sys.exit(143)

        signal.signal(signal.SIGTERM, term_handler)

    # On-demand all-thread dump: `kill -USR1 <pid>` (chains any existing handler).
    if hasattr(signal, "SIGUSR1"):
        faulthandler.register(signal.SIGUSR1, file=sys.stderr, all_threads=True, chain=True)


def _install_hang_watchdog(logger: logging.Logger) -> None:
    raw = os.environ.get("DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT", "").strip()
    if not raw:
        return
    try:
        timeout = float(raw)
    except ValueError:
        logger.warning("diagnostics: invalid DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT=%r", raw)
        return
    if timeout > 0:
        # Periodically dump every thread's stack while the process is wedged.
        faulthandler.dump_traceback_later(timeout, repeat=True, exit=False, file=sys.stderr)
        logger.info("diagnostics: hang watchdog enabled (every %ss)", timeout)


def install_diagnostics() -> None:
    """Install crash/hang/exception diagnostics. Idempotent, safe, never raises."""
    if getattr(sys, _SENTINEL_ATTR, False) or _is_disabled():
        return
    setattr(sys, _SENTINEL_ATTR, True)
    try:
        logger = _setup_logging()
        faulthandler.enable(file=_fault_stream, all_threads=True)
        _install_excepthooks(logger)
        _install_signal_handlers(logger)
        _install_hang_watchdog(logger)
        logger.info("diagnostics: installed (pid=%s)", os.getpid())
    except Exception as exc:  # never break the host app
        try:
            print(f"app_diagnostics: install failed: {exc!r}", file=sys.stderr)
        except Exception:
            pass


def install_asyncio_handler(loop) -> None:
    """Log exceptions that an asyncio event loop would otherwise swallow.

    Call from a running-loop context (e.g. a FastAPI startup hook); there is no
    loop at import time so this is separate from install_diagnostics().
    """
    try:
        logger = logging.getLogger(_LOGGER_NAME)
        prev = loop.get_exception_handler()

        def handler(loop_, context):
            msg = context.get("message", "asyncio error")
            exc = context.get("exception")
            if exc is not None:
                logger.critical("asyncio: %s", msg, exc_info=exc)
            else:
                logger.critical("asyncio: %s (%r)", msg, context)
            if callable(prev):
                prev(loop_, context)

        loop.set_exception_handler(handler)
    except Exception as exc:
        try:
            print(f"app_diagnostics: asyncio handler install failed: {exc!r}", file=sys.stderr)
        except Exception:
            pass
