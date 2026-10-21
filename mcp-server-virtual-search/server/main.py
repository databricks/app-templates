"""Entry point: ``uv run virtual-mcp-search-server`` starts the app with uvicorn."""

# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import argparse
import os

import uvicorn

from server.request_context import running_in_databricks_apps


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the virtual MCP server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("DATABRICKS_APP_PORT", "8000")),
        help="Port to listen on (default: $DATABRICKS_APP_PORT or 8000)",
    )
    args = parser.parse_args()
    # Locally, requests without a forwarded token run as the developer, so listen on
    # loopback only. In Databricks Apps the platform proxy must reach the app.
    host = "0.0.0.0" if running_in_databricks_apps() else "127.0.0.1"
    uvicorn.run("server.app:application", host=host, port=args.port)
