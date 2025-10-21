#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Starting MCP Server - Local Development"
echo "=========================================="
echo ""

echo "Step 1: Syncing dependencies..."
cd "$PROJECT_ROOT"
uv sync
echo "✓ Dependencies synced"
echo ""

echo "Step 2: Starting MCP server on http://localhost:8000..."
echo "Note: Server will run in foreground. Press Ctrl+C to stop."
echo ""
uv run custom-mcp-server &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to be ready..."
sleep 3

echo ""
echo "Step 3: Testing MCP client connection..."
python "$SCRIPT_DIR/test_client_local.py"

echo ""
echo "=========================================="
echo "Server is running! (PID: $SERVER_PID)"
echo "MCP endpoint: http://localhost:8000/mcp"
echo "Press Ctrl+C to stop the server"
echo "=========================================="

# Wait for server process
wait $SERVER_PID
