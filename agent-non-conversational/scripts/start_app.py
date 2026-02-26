#!/usr/bin/env python3
"""
Start script for running frontend and backend processes concurrently.

Requirements:
1. Not reporting ready until BOTH frontend and backend processes are ready
2. Exiting as soon as EITHER process fails
3. Printing error logs if either process fails

Usage:
    start-app [OPTIONS]

All options are passed through to the backend server (start-server).
See 'uv run start-server --help' for available options.
"""

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

# Readiness patterns
BACKEND_READY = [r"Uvicorn running on", r"Application startup complete", r"Started server process"]
FRONTEND_READY = [r"Server is running on http://localhost"]


def check_port_available(port: int) -> bool:
    """Check if a port is available by attempting to bind to it."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False


class ProcessManager:
    def __init__(self, port=8000, no_ui=False):
        self.backend_process = None
        self.frontend_process = None
        self.backend_ready = False
        self.frontend_ready = False
        self.failed = threading.Event()
        self.backend_log = None
        self.frontend_log = None
        self.port = port
        self.no_ui = no_ui

    def check_ports(self):
        """Check that required ports are available before starting processes."""
        backend_port = self.port

        errors = []
        if not check_port_available(backend_port):
            errors.append(
                f"Port {backend_port} (backend) is already in use.\n"
                f"  To free it: lsof -ti :{backend_port} | xargs kill -9"
            )

        if not self.no_ui:
            frontend_port = int(os.environ.get("CHAT_APP_PORT", os.environ.get("PORT", "3000")))

            if backend_port == frontend_port:
                errors.append(
                    f"Port {backend_port} is used by both backend and frontend.\n"
                    f"  Set CHAT_APP_PORT in .env to a different port (e.g., CHAT_APP_PORT=3000)."
                )

            if not check_port_available(frontend_port):
                port_source = (
                    "CHAT_APP_PORT" if os.environ.get("CHAT_APP_PORT")
                    else "PORT" if os.environ.get("PORT")
                    else "default"
                )
                errors.append(
                    f"Port {frontend_port} (frontend, source: {port_source}) is already in use.\n"
                    f"  To free it: lsof -ti :{frontend_port} | xargs kill -9\n"
                    f"  Or set a different port: CHAT_APP_PORT=<port> in .env"
                )

        if errors:
            print("ERROR: Port(s) already in use:\n")
            for error in errors:
                print(f"  {error}\n")
            sys.exit(1)

    def monitor_process(self, process, name, log_file, patterns):
        is_ready = False
        try:
            for line in iter(process.stdout.readline, ""):
                if not line:
                    break

                line = line.rstrip()
                log_file.write(line + "\n")
                print(f"[{name}] {line}")

                # Check readiness
                if not is_ready and any(re.search(p, line, re.IGNORECASE) for p in patterns):
                    is_ready = True
                    if name == "backend":
                        self.backend_ready = True
                    else:
                        self.frontend_ready = True
                    print(f"✓ {name.capitalize()} is ready!")

                    if self.no_ui and self.backend_ready:
                        print("\n" + "=" * 50)
                        print("✓ Backend is ready! (running without UI)")
                        print(f"✓ API available at http://localhost:{self.port}")
                        print("=" * 50 + "\n")
                    elif self.backend_ready and self.frontend_ready:
                        print("\n" + "=" * 50)
                        print("✓ Both frontend and backend are ready!")
                        print(f"✓ Open the frontend at http://localhost:{self.port}")
                        print("=" * 50 + "\n")

            process.wait()
            if process.returncode != 0:
                self.failed.set()

        except Exception as e:
            print(f"Error monitoring {name}: {e}")
            self.failed.set()

    def clone_frontend_if_needed(self):
        if Path("e2e-chatbot-app-next").exists():
            return True

        print("Cloning e2e-chatbot-app-next...")
        for url in [
            "https://github.com/databricks/app-templates.git",
            "git@github.com:databricks/app-templates.git",
        ]:
            try:
                subprocess.run(
                    ["git", "clone", "--filter=blob:none", "--sparse", url, "temp-app-templates"],
                    check=True,
                    capture_output=True,
                )
                break
            except subprocess.CalledProcessError:
                continue
        else:
            print("ERROR: Failed to clone repository.")
            print(
                "Manually download from: https://download-directory.github.io/?url=https://github.com/databricks/app-templates/tree/main/e2e-chatbot-app-next"
            )
            return False

        subprocess.run(
            ["git", "sparse-checkout", "set", "e2e-chatbot-app-next"],
            cwd="temp-app-templates",
            check=True,
        )
        Path("temp-app-templates/e2e-chatbot-app-next").rename("e2e-chatbot-app-next")
        shutil.rmtree("temp-app-templates", ignore_errors=True)
        return True

    def start_process(self, cmd, name, log_file, patterns, cwd=None):
        print(f"Starting {name}...")
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, cwd=cwd
        )

        thread = threading.Thread(
            target=self.monitor_process, args=(process, name, log_file, patterns), daemon=True
        )
        thread.start()
        return process

    def print_logs(self, log_path):
        print(f"\nLast 50 lines of {log_path}:")
        print("-" * 40)
        try:
            lines = Path(log_path).read_text().splitlines()
            print("\n".join(lines[-50:]))
        except FileNotFoundError:
            print(f"(no {log_path} found)")
        print("-" * 40)

    def cleanup(self):
        print("\n" + "=" * 42)
        print("Shutting down..." if self.no_ui else "Shutting down both processes...")
        print("=" * 42)

        for proc in [self.backend_process, self.frontend_process]:
            if proc:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except (subprocess.TimeoutExpired, Exception):
                    proc.kill()

        if self.backend_log:
            self.backend_log.close()
        if self.frontend_log:
            self.frontend_log.close()

    def run(self, backend_args=None):
        load_dotenv(dotenv_path=".env", override=True)
        if not os.environ.get("DATABRICKS_APP_NAME"):
            self.check_ports()

        if not self.no_ui:
            if not self.clone_frontend_if_needed():
                print("WARNING: Failed to clone frontend. Continuing with backend only.")
                self.no_ui = True
            else:
                # Set API_PROXY environment variable for frontend to connect to backend
                os.environ["API_PROXY"] = f"http://localhost:{self.port}/invocations"

        # Open log files
        self.backend_log = open("backend.log", "w", buffering=1)
        if not self.no_ui:
            self.frontend_log = open("frontend.log", "w", buffering=1)

        try:
            # Build backend command, passing through all arguments
            backend_cmd = ["uv", "run", "start-server"]
            if backend_args:
                backend_cmd.extend(backend_args)

            # Start backend
            self.backend_process = self.start_process(
                backend_cmd, "backend", self.backend_log, BACKEND_READY
            )

            if not self.no_ui:
                # Setup and start frontend
                frontend_dir = Path("e2e-chatbot-app-next")
                for cmd, desc in [("npm install", "install"), ("npm run build", "build")]:
                    print(f"Running npm {desc}...")
                    result = subprocess.run(
                        cmd.split(), cwd=frontend_dir, capture_output=True, text=True
                    )
                    if result.returncode != 0:
                        print(f"npm {desc} failed: {result.stderr}")
                        return 1

                self.frontend_process = self.start_process(
                    ["npm", "run", "start"],
                    "frontend",
                    self.frontend_log,
                    FRONTEND_READY,
                    cwd=frontend_dir,
                )

                print(
                    f"\nMonitoring processes (Backend PID: {self.backend_process.pid}, Frontend PID: {self.frontend_process.pid})\n"
                )
            else:
                print(f"\nMonitoring backend process (PID: {self.backend_process.pid})\n")

            # Wait for failure
            while not self.failed.is_set():
                time.sleep(0.1)
                if self.backend_process.poll() is not None:
                    self.failed.set()
                    break
                if not self.no_ui and self.frontend_process and self.frontend_process.poll() is not None:
                    self.failed.set()
                    break

            # Determine which failed
            if self.no_ui or self.backend_process.poll() is not None:
                failed_name = "backend"
                failed_proc = self.backend_process
            else:
                failed_name = "frontend"
                failed_proc = self.frontend_process
            exit_code = failed_proc.returncode if failed_proc else 1

            print(
                f"\n{'=' * 42}\nERROR: {failed_name} process exited with code {exit_code}\n{'=' * 42}"
            )
            self.print_logs("backend.log")
            if not self.no_ui:
                self.print_logs("frontend.log")
            return exit_code

        except KeyboardInterrupt:
            print("\nInterrupted")
            return 0

        finally:
            self.cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Start agent frontend and backend",
        usage="%(prog)s [OPTIONS]\n\nAll options are passed through to start-server. "
        "Use 'uv run start-server --help' for available options."
    )
    parser.add_argument(
        "--no-ui",
        action="store_true",
        help="Run backend only, skip frontend UI",
    )
    args, backend_args = parser.parse_known_args()

    # Extract port from backend_args if specified
    port = 8000
    for i, arg in enumerate(backend_args):
        if arg == "--port" and i + 1 < len(backend_args):
            try:
                port = int(backend_args[i + 1])
            except ValueError:
                pass
            break

    sys.exit(ProcessManager(port=port, no_ui=args.no_ui).run(backend_args))


if __name__ == "__main__":
    main()
