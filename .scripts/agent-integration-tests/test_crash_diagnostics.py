"""Crash-diagnostics e2e: run the crash-example fixtures and assert that crashing
routes a diagnostic stack trace to stderr (the Databricks Apps log stream).

Inverted success criterion vs the deploy-validation suite: a case passes when the
app CRASHES and the diagnostic traceback (marker DIAGNOSTICS_E2E_CANARY + evidence
from the diagnostics module) is captured — not when it serves.

Local only (subprocess) — no deploy/SSO needed. The deployed counterpart (crash in
the shared app, read `databricks apps logs`) is a later, SSO-gated increment.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
EXAMPLES = HERE / "crash-examples"
SOURCE = HERE.parent / "source"  # .scripts/source (canonical app_diagnostics.py)
CANARY = "DIAGNOSTICS_E2E_CANARY"
TIMEOUT = 30

# (id, language, crash_mode)
CASES = [
    ("python-startup", "python", "startup"),
    ("python-thread", "python", "thread"),
    ("node-startup", "node", "startup"),
    ("node-rejection", "node", "rejection"),
]


def _run_python(mode: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONPATH": str(SOURCE), "CRASH_MODE": mode}
    return subprocess.run(
        [sys.executable, "app.py"],
        cwd=EXAMPLES / "python_crash_app",
        env=env, capture_output=True, text=True, timeout=TIMEOUT,
    )


def _run_node(mode: str) -> subprocess.CompletedProcess:
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    env = {**os.environ, "CRASH_MODE": mode}
    return subprocess.run(
        ["node", "index.mjs"],
        cwd=EXAMPLES / "node_crash_app",
        env=env, capture_output=True, text=True, timeout=TIMEOUT,
    )


@pytest.mark.parametrize("case_id,lang,mode", CASES, ids=[c[0] for c in CASES])
def test_crash_is_diagnosed(case_id, lang, mode):
    proc = _run_python(mode) if lang == "python" else _run_node(mode)
    err = proc.stderr or ""

    # 1. It actually crashed (non-zero exit) — the whole point of the fixture.
    assert proc.returncode != 0, f"expected a crash (non-zero exit), got 0.\nstderr:\n{err[-1500:]}"
    # 2. The induced-crash marker reached the log stream.
    assert CANARY in err, f"crash marker not in stderr.\nstderr:\n{err[-1500:]}"
    # 3. The diagnostics module produced the record (not just a bare interpreter dump).
    assert "app.diagnostics" in err, f"no diagnostics-module evidence in stderr.\nstderr:\n{err[-1500:]}"
    # 4. A stack trace is present so the cause is actually diagnosable.
    assert ("Traceback" in err) or ("at " in err) or ("stack" in err.lower()), (
        f"no stack trace captured.\nstderr:\n{err[-1500:]}"
    )
    if lang == "python" and mode == "thread":
        assert "crash-worker" in err, "thread name missing from the diagnostic record"
