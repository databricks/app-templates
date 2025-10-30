import argparse

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Start the MCP server")
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to run the server on (default: 8000)"
    )
    args = parser.parse_args()

    uvicorn.run(
        "custom_server.app:combined_app",  # import path to your `app`
        host="0.0.0.0",
        port=args.port,
    )
