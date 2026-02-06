#!/bin/bash
set -e

echo "🚀 Starting TypeScript Agent..."
echo "Current directory: $(pwd)"

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: Agent dist directory not found!"
  exit 1
fi

# Check if UI exists and is built
if [ -d "ui" ] && [ -d "ui/server/dist" ] && [ -d "ui/client/dist" ]; then
  echo "✅ UI build found, starting with UI..."

  # Start agent server in background on port 5001
  echo "Starting agent server on port 5001..."
  PORT=5001 node dist/src/server.js &
  AGENT_PID=$!

  # Wait for agent to be ready
  sleep 2

  # Start UI server on port 8000 (the exposed port for Databricks Apps)
  echo "Starting UI server on port 8000..."
  cd ui
  API_PROXY=http://localhost:5001/invocations PORT=8000 npm start &
  UI_PID=$!

  # Function to cleanup background processes on exit
  cleanup() {
    echo "Shutting down..."
    kill $AGENT_PID 2>/dev/null || true
    kill $UI_PID 2>/dev/null || true
    exit
  }

  # Set up trap for cleanup
  trap cleanup SIGTERM SIGINT EXIT

  # Wait for either process to exit
  wait -n
  # If one exits, kill the other and exit
  cleanup
else
  echo "ℹ️  UI not found, starting agent-only mode on port 8000..."
  PORT=8000 node dist/src/server.js
fi
