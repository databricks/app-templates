#!/bin/bash
set -e

echo "🚀 Starting Unified TypeScript Agent + UI Server..."
echo "Current directory: $(pwd)"

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: Build directory not found! Run 'npm run build' first."
  exit 1
fi

# Check if main.js exists
if [ ! -f "dist/src/main.js" ]; then
  echo "ERROR: Unified server entry point (dist/src/main.js) not found!"
  exit 1
fi

# Start unified server on port 8000 in in-process mode (both agent and UI)
PORT=8000 node dist/src/main.js

echo "✅ Server stopped gracefully"
