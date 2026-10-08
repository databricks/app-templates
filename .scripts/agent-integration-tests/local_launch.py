"""Launch template apps locally, by family, for functional tests."""
from __future__ import annotations
import os, shutil, subprocess, time
from pathlib import Path
import requests
from functional_config import FunctionalTemplate
from helpers import _log, find_free_port, stop_server, _run_cmd

# Databricks package proxies — pypi.org / npmjs.org are frequently unreachable
# from this environment, so dependency installs must go through these mirrors.
PYPI_PROXY = "https://pypi-proxy.cloud.databricks.com/simple"
NPM_PROXY = "https://npm-proxy.cloud.databricks.com"

# Databricks Apps run on Python 3.11; pin requirements.txt venvs to it so pinned
# deps (e.g. psycopg~=3.1, streamlit~=1.38) resolve to wheels that exist, rather
# than letting uv grab a newer system Python with no matching wheels.
APPS_PYTHON = "3.11"

PY_FAMILIES = ("streamlit", "dash", "gradio", "shiny", "flask")


def _uv_env() -> dict:
    """Env for uv commands: route to the pypi proxy and trust system certs."""
    return {**os.environ, "UV_INDEX_URL": PYPI_PROXY, "UV_SYSTEM_CERTS": "1"}


def _ensure_venv(template_dir: Path, env: dict) -> None:
    """Create a .venv pinned to the Apps Python if missing or on the wrong version."""
    venv = template_dir / ".venv"
    cfg = venv / "pyvenv.cfg"
    on_right_python = (
        cfg.exists()
        and any(line.strip().startswith(f"version_info = {APPS_PYTHON}.")
                for line in cfg.read_text().splitlines())
    )
    if on_right_python:
        return
    shutil.rmtree(venv, ignore_errors=True)
    r = _run_cmd(["uv", "venv", "--python", APPS_PYTHON], cwd=template_dir, env=env, timeout=180)
    if r.returncode != 0:
        raise RuntimeError(f"uv venv --python {APPS_PYTHON} failed:\n{r.stderr[-2000:]}")


def ensure_deps(ft: FunctionalTemplate, template_dir: Path) -> None:
    """Install the template's dependencies so a fresh checkout can launch.

    Idempotent: safe to re-run when a .venv / node_modules already exists.
    uv-project families (agent, mcp) are synced by `uv run` at launch time.
    """
    f = ft.family
    if f == "node":
        env = {**os.environ, "npm_config_registry": NPM_PROXY}
        r = _run_cmd(["npm", "install"], cwd=template_dir, env=env, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"[{ft.name}] npm install failed:\n{r.stderr[-2000:]}")
        return
    if f in PY_FAMILIES:
        env = _uv_env()
        if (template_dir / "pyproject.toml").exists():
            r = _run_cmd(["uv", "sync"], cwd=template_dir, env=env, timeout=600)
        elif (template_dir / "requirements.txt").exists():
            _ensure_venv(template_dir, env)
            # Target the venv explicitly: without --python, `uv pip install`
            # resolves against uv's default (newest system) interpreter, not .venv.
            vpy = template_dir / ".venv" / "bin" / "python"
            r = _run_cmd(["uv", "pip", "install", "--python", str(vpy), "-r", "requirements.txt"],
                         cwd=template_dir, env=env, timeout=600)
        else:
            raise RuntimeError(f"[{ft.name}] no pyproject.toml or requirements.txt to install")
        if r.returncode != 0:
            raise RuntimeError(f"[{ft.name}] dependency install failed:\n{r.stderr[-2000:]}")


def build_launch_command(ft: FunctionalTemplate, port: int) -> list[str]:
    f = ft.family
    # python families run from the template's own .venv (launch_local puts
    # .venv/bin on PATH + sets VIRTUAL_ENV). These templates ship a
    # requirements.txt and no pyproject, so `uv run` would build an ephemeral
    # env without the app's deps instead of using .venv.
    if f == "streamlit":
        return ["streamlit", "run", "app.py",
                "--server.port", str(port), "--server.headless", "true"]
    if f in ("dash", "gradio", "shiny", "flask"):
        # these read PORT from env (set by launch_local); run their entrypoint
        if f == "flask":
            return ["flask", "--app", "app.py", "run", "--port", str(port)]
        return ["python", "app.py"]
    if f == "node":
        return ["npm", "run", ft.launch.get("dev_script", "dev")]
    if f == "agent":
        return ["uv", "run", "start-server", "--port", str(port)]
    if f == "mcp":
        return ["uv", "run", ft.launch.get("server_cmd", "custom-mcp-server"), "--port", str(port)]
    raise ValueError(f"unknown family {f!r}")


def wait_ready(base_url: str, path: str, deadline_s: int = 120) -> None:
    deadline = time.time() + deadline_s
    url = f"{base_url}{path}"
    while time.time() < deadline:
        try:
            if requests.get(url, timeout=5).status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(2)
    raise TimeoutError(f"{url} not ready within {deadline_s}s")


def launch_local(ft: FunctionalTemplate, template_dir: Path) -> tuple[subprocess.Popen, str]:
    ensure_deps(ft, template_dir)
    port = find_free_port()
    if ft.family == "node":
        env = {**os.environ, "PORT": str(port), "npm_config_registry": NPM_PROXY}
    elif ft.family in PY_FAMILIES:
        # activate the template's .venv so bare `streamlit`/`python`/`flask` resolve
        venv_bin = str((template_dir / ".venv" / "bin").resolve())
        env = {**_uv_env(), "PORT": str(port), "VIRTUAL_ENV": str((template_dir / ".venv").resolve()),
               "PATH": venv_bin + os.pathsep + os.environ.get("PATH", "")}
    else:  # uv-project families (agent/mcp): `uv run` uses their managed venv
        env = {**_uv_env(), "PORT": str(port)}
    cmd = build_launch_command(ft, port)
    _log(f"[{ft.name}] launching: {' '.join(cmd)} (port {port})")
    proc = subprocess.Popen(cmd, cwd=template_dir, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, preexec_fn=os.setsid)
    base_url = f"http://127.0.0.1:{port}"
    try:
        wait_ready(base_url, ft.launch.get("ready_path", "/"))
    except TimeoutError:
        # Terminate the (still-running) child FIRST. Reading a live child's
        # stderr pipe blocks until the child closes it or the buffer fills — if
        # the app stays up but never serves the ready path, that read hangs
        # forever and the test never tears down. Once stop_server has killed the
        # process group, the pipe reaches EOF and the read returns promptly.
        stop_server(proc)
        err = proc.stderr.read() if proc.stderr else ""
        raise TimeoutError(f"[{ft.name}] did not become ready. stderr:\n{err[:2000]}")
    return proc, base_url


def teardown(proc: subprocess.Popen) -> None:
    stop_server(proc)
