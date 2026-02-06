#!/bin/bash
set -e

echo "🚀 Starting TypeScript Agent..."
echo "Current directory: $(pwd)"

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: Agent dist directory not found!"
  exit 1
fi

# Check if UI client build exists
if [ -d "ui/client/dist" ]; then
  echo "✅ UI build found - agent will serve UI on port 8000"
else
  echo "ℹ️  UI not found - running agent-only mode on port 8000"
fi

# Start agent server on port 8000 (exposed port for Databricks Apps)
# Agent serves both /invocations endpoint and UI static files
PORT=8000 node dist/src/server.js
