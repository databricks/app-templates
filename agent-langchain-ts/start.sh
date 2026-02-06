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

  # Install concurrently if not present (for running both servers)
  if ! command -v concurrently &> /dev/null; then
    npm install -g concurrently
  fi

  # Start both servers:
  # - Agent on internal port 5001 (provides /invocations)
  # - UI on port 8000 (serves frontend + proxies to agent)
  npx concurrently \
    --names "AGENT,UI" \
    --prefix-colors "blue,green" \
    "PORT=5001 node dist/src/server.js" \
    "cd ui && API_PROXY=http://localhost:5001/invocations PORT=8000 npm start"
else
  echo "ℹ️  UI not found, starting agent-only mode on port 8000..."
  PORT=8000 node dist/src/server.js
fi
