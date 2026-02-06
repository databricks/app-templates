#!/usr/bin/env python3
"""
Start script for running frontend and backend processes concurrently.

Requirements:
1. Prioritize starting the backend first
2. Not reporting ready until BOTH frontend and backend processes are ready
3. Exiting as soon as EITHER process fails
4. Printing error logs if either process fails

Usage:
    start-app [OPTIONS]

All options are passed through to the backend server (start-server).
"""

import argparse
import asyncio
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

# Readiness patterns
BACKEND_READY = [r"Uvicorn running on", r"Application startup complete", r"Started server process"]
FRONTEND_READY = [r"Server is running on http://localhost"]


class AsyncProcessManager:
    def __init__(self, port=8000):
        self.backend_process = None
        self.frontend_process = None
        self.backend_ready = asyncio.Event()
        self.frontend_ready = asyncio.Event()
        self.failed = asyncio.Event()
        self.failed_process_name = None
        self.backend_log = None
        self.frontend_log = None
        self.port = port

    async def monitor_process(self, process, name, log_file, patterns):
        """Monitor a process's output for readiness patterns and failures."""
        is_ready = False
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                line = line.decode().rstrip()
                log_file.write(line + "\n")
                log_file.flush()
                print(f"[{name}] {line}")

                # Check readiness
                if not is_ready and any(re.search(p, line, re.IGNORECASE) for p in patterns):
                    is_ready = True
                    if name == "backend":
                        self.backend_ready.set()
                    else:
                        self.frontend_ready.set()
                    print(f"✓ {name.capitalize()} is ready!")

            # Process exited - check return code
            await process.wait()
            if process.returncode != 0:
                self.failed_process_name = name
                self.failed.set()

        except Exception as e:
            print(f"Error monitoring {name}: {e}")
            self.failed_process_name = name
            self.failed.set()

    async def wait_for_both_ready(self):
        """Wait for both processes to be ready or for a failure."""
        ready_task = asyncio.create_task(self._wait_both_ready())
        failed_task = asyncio.create_task(self.failed.wait())

        done, pending = await asyncio.wait(
            [ready_task, failed_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

        if self.failed.is_set():
            return False

        print("\n" + "=" * 50)
        print("✓ Both frontend and backend are ready!")
        print(f"✓ Open the frontend at http://localhost:{self.port}")
        print("=" * 50 + "\n")
        return True

    async def _wait_both_ready(self):
        """Wait for both backend and frontend to be ready."""
        await self.backend_ready.wait()
        await self.frontend_ready.wait()

    def clone_frontend_if_needed(self):
        """Clone the frontend repository if it doesn't exist."""
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

    async def start_backend(self, backend_args=None):
        """Start the backend process using python directly."""
        print("Starting backend...")
        cmd = [sys.executable, "-m", "agent_server.start_server"]
        if backend_args:
            cmd.extend(backend_args)

        self.backend_process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        return self.backend_process

    async def start_frontend(self):
        """Start the frontend process."""
        frontend_dir = Path("e2e-chatbot-app-next")

        # Run npm install and build synchronously first
        for cmd, desc in [("npm install", "install"), ("npm run build", "build")]:
            print(f"Running npm {desc}...")
            result = subprocess.run(
                cmd.split(), cwd=frontend_dir, capture_output=True, text=True
            )
            if result.returncode != 0:
                print(f"npm {desc} failed: {result.stderr}")
                return None

        print("Starting frontend...")
        self.frontend_process = await asyncio.create_subprocess_exec(
            "npm", "run", "start",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=frontend_dir,
        )
        return self.frontend_process

    def print_logs(self, log_path):
        """Print the last 50 lines of a log file."""
        print(f"\nLast 50 lines of {log_path}:")
        print("-" * 40)
        try:
            lines = Path(log_path).read_text().splitlines()
            print("\n".join(lines[-50:]))
        except FileNotFoundError:
            print(f"(no {log_path} found)")
        print("-" * 40)

    async def cleanup(self):
        """Clean up all processes and resources."""
        print("\n" + "=" * 42)
        print("Shutting down both processes...")
        print("=" * 42)

        for proc in [self.backend_process, self.frontend_process]:
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
                except Exception:
                    pass

        if self.backend_log:
            self.backend_log.close()
        if self.frontend_log:
            self.frontend_log.close()

    async def run(self, backend_args=None):
        """Main entry point to run both processes."""
        load_dotenv(dotenv_path=".env", override=True)

        if not self.clone_frontend_if_needed():
            return 1

        # Set API_PROXY environment variable for frontend to connect to backend
        os.environ["API_PROXY"] = f"http://localhost:{self.port}/invocations"

        # Open log files
        self.backend_log = open("backend.log", "w", buffering=1)
        self.frontend_log = open("frontend.log", "w", buffering=1)

        try:
            # Start backend first (prioritized)
            backend_proc = await self.start_backend(backend_args)
            if not backend_proc:
                print("ERROR: Failed to start backend")
                return 1

            # Start monitoring backend immediately
            backend_monitor = asyncio.create_task(
                self.monitor_process(backend_proc, "backend", self.backend_log, BACKEND_READY)
            )

            # Start frontend
            frontend_proc = await self.start_frontend()
            if not frontend_proc:
                print("ERROR: Failed to start frontend")
                return 1

            # Start monitoring frontend
            frontend_monitor = asyncio.create_task(
                self.monitor_process(frontend_proc, "frontend", self.frontend_log, FRONTEND_READY)
            )

            print(
                f"\nMonitoring processes (Backend PID: {backend_proc.pid}, Frontend PID: {frontend_proc.pid})\n"
            )

            # Wait for both to be ready
            await self.wait_for_both_ready()

            # Continue monitoring until failure or completion
            await asyncio.gather(backend_monitor, frontend_monitor)

            # Determine exit code
            if self.failed.is_set():
                failed_proc = (
                    self.backend_process if self.failed_process_name == "backend" else self.frontend_process
                )
                exit_code = failed_proc.returncode if failed_proc else 1

                print(
                    f"\n{'=' * 42}\nERROR: {self.failed_process_name} process exited with code {exit_code}\n{'=' * 42}"
                )
                self.print_logs("backend.log")
                self.print_logs("frontend.log")
                return exit_code

            return 0

        except asyncio.CancelledError:
            print("\nCancelled")
            return 0

        finally:
            await self.cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Start agent frontend and backend",
        usage="%(prog)s [OPTIONS]\n\nAll options are passed through to the backend server.",
    )
    # Parse known args (none currently) and pass remaining to backend
    _, backend_args = parser.parse_known_args()

    # Extract port from backend_args if specified
    port = 8000
    for i, arg in enumerate(backend_args):
        if arg == "--port" and i + 1 < len(backend_args):
            try:
                port = int(backend_args[i + 1])
            except ValueError:
                pass
            break

    try:
        sys.exit(asyncio.run(AsyncProcessManager(port=port).run(backend_args)))
    except KeyboardInterrupt:
        print("\nInterrupted")
        sys.exit(0)


if __name__ == "__main__":
    main()
