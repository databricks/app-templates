"""Intentional-crash fixture for the diagnostics e2e test. NOT a real template.

Installs the diagnostics bootstrap, then crashes so the test can confirm the
traceback reaches stderr (the Databricks Apps log stream). CRASH_MODE selects the
failure mode. Every crash carries the marker DIAGNOSTICS_E2E_CANARY.

`app_diagnostics` is the canonical module in .scripts/source/; the test supplies it
on PYTHONPATH (local) or copies it alongside (deploy).
"""
import os
import sys
import threading
import time

import app_diagnostics

app_diagnostics.install_diagnostics()

CANARY = "DIAGNOSTICS_E2E_CANARY"
mode = os.environ.get("CRASH_MODE", "startup")

if mode == "thread":
    def _boom():
        raise RuntimeError(f"{CANARY}: induced crash in worker thread")

    worker = threading.Thread(target=_boom, name="crash-worker")
    worker.start()
    worker.join()
    time.sleep(0.2)  # let threading.excepthook flush to stderr
    sys.exit(17)
elif mode == "sigterm":
    import signal

    os.kill(os.getpid(), signal.SIGTERM)  # exercise the SIGTERM all-thread dump
    time.sleep(5)
else:  # "startup": unhandled exception at import time -> sys.excepthook
    raise RuntimeError(f"{CANARY}: induced startup crash")
