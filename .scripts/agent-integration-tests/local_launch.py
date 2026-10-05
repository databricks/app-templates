"""Launch template apps locally, by family, for functional tests."""
from __future__ import annotations
import os, subprocess, time
from pathlib import Path
import requests
from functional_config import FunctionalTemplate
from helpers import _log, find_free_port, stop_server


def build_launch_command(ft: FunctionalTemplate, port: int) -> list[str]:
    f = ft.family
    if f == "streamlit":
        return ["streamlit", "run", "app.py", "--server.port", str(port), "--server.headless", "true"]
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
        return ["uv", "run", ft.launch.get("server_cmd", "custom-mcp-server")]
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
    port = find_free_port()
    env = {**os.environ, "PORT": str(port)}
    cmd = build_launch_command(ft, port)
    _log(f"[{ft.name}] launching: {' '.join(cmd)} (port {port})")
    proc = subprocess.Popen(cmd, cwd=template_dir, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, preexec_fn=os.setsid)
    base_url = f"http://127.0.0.1:{port}"
    try:
        wait_ready(base_url, ft.launch.get("ready_path", "/"))
    except TimeoutError:
        err = proc.stderr.read() if proc.stderr else ""
        stop_server(proc)
        raise TimeoutError(f"[{ft.name}] did not become ready. stderr:\n{err[:2000]}")
    return proc, base_url


def teardown(proc: subprocess.Popen) -> None:
    stop_server(proc)
