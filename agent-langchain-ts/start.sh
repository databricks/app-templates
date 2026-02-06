#!/bin/bash
set -e

echo "🚀 Starting TypeScript Agent..."
echo "Current directory: $(pwd)"

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: Agent dist directory not found!"
  exit 1
fi

# Check if UI server build exists
if [ -d "ui/server/dist" ]; then
  echo "✅ UI backend found - running two-server architecture"

  # Start agent server on internal port 8001 (provides /invocations)
  PORT=8001 node dist/src/server.js &
  AGENT_PID=$!
  echo "Agent server started on port 8001 (PID: $AGENT_PID)"

  # Give agent a moment to start
  sleep 2

  # Start UI server on port 8000 (exposed port) with API_PROXY to agent
  cd ui/server
  API_PROXY=http://localhost:8001/invocations PORT=8000 node dist/index.js &
  UI_PID=$!
  echo "UI server started on port 8000 (PID: $UI_PID)"
  cd ../..

  # Wait for both processes
  wait $AGENT_PID $UI_PID
else
  echo "ℹ️  UI backend not found - running agent-only mode on port 8000"
  PORT=8000 node dist/src/server.js
fi
