#!/bin/bash
set -e

echo "🚀 Starting TypeScript Agent..."
echo "Current directory: $(pwd)"

# Build agent if dist is missing (first deploy — dist is gitignored)
if [ ! -d "dist" ]; then
  echo "📦 Building agent (dist not found)..."
  npm install
  npm run build:agent
fi

# Set up and build UI if missing
if [ ! -d "ui/server/dist" ]; then
  echo "📦 Setting up and building UI..."
  bash scripts/setup-ui.sh
  npm run build:ui
fi

# Check if UI server build exists
if [ -d "ui/server/dist" ]; then
  echo "✅ UI backend found - running agent-first two-server architecture"

  # Start UI server on internal port 3000 (provides /api/chat, /api/session, etc.)
  # Run in development mode so it doesn't serve static files (agent server handles that)
  cd ui/server
  NODE_ENV=development API_PROXY=http://localhost:8000/invocations AGENT_URL=http://localhost:8000 PORT=3000 node dist/index.mjs &
  UI_PID=$!
  echo "UI backend started on port 3000 (PID: $UI_PID) in development mode"
  cd ../..

  # Give UI backend a moment to start
  sleep 2

  # Start agent server on port 8000 (exposed port) - provides /invocations and proxies /api/*
  PORT=8000 UI_BACKEND_URL=http://localhost:3000 node dist/src/main.js &
  AGENT_PID=$!
  echo "Agent server started on port 8000 (PID: $AGENT_PID)"
  echo "🌐 Access the app at http://localhost:8000"

  # Wait for both processes
  wait $AGENT_PID $UI_PID
else
  echo "ℹ️  UI backend not found - running agent-only mode on port 8000"
  PORT=8000 node dist/src/main.js
fi
