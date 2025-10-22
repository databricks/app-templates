#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Test MCP Server - Local Development"
echo "=========================================="
echo ""

echo "Step 1: Syncing dependencies..."
cd "$PROJECT_ROOT"
uv sync
echo "✓ Dependencies synced"
echo ""

echo "Step 2: Starting MCP server on http://localhost:8000..."
uv run custom-mcp-server &
SERVER_PID=$!

# Ensure server is stopped on exit
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        echo ""
        echo "Stopping MCP server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null
        wait $SERVER_PID 2>/dev/null
        echo "✓ Server stopped"
    fi
}
trap cleanup EXIT

# Wait for server to start
echo "Waiting for server to be ready..."
sleep 3

echo ""
echo "Step 3: Testing MCP client connection..."
python "$SCRIPT_DIR/test_local.py"

TEST_EXIT_CODE=$?

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "=========================================="
    echo "✓ Local MCP Server Test Complete!"
    echo "=========================================="
else
    echo "=========================================="
    echo "✗ Local MCP Server Test Failed"
    echo "=========================================="
    exit 1
fi
