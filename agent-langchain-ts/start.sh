#!/bin/bash
set -e

echo "🚀 Starting Unified TypeScript Agent + UI Server..."
echo "Current directory: $(pwd)"

# Build agent if dist is missing (first deploy — dist is gitignored)
if [ ! -f "dist/src/main.js" ]; then
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

# Start unified server on port 8000 in in-process mode (both agent and UI)
PORT=8000 node dist/src/main.js

echo "✅ Server stopped gracefully"
