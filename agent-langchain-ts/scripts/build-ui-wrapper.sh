#!/bin/bash
# UI build wrapper that skips if dist folders already exist

if [ -d "ui/client/dist" ] && [ -d "ui/server/dist" ]; then
  echo "✓ Using pre-built UI (ui/client/dist and ui/server/dist found)"
  exit 0
fi

echo "Building UI from source..."
# Install with --include=dev to ensure build tools (like vite) are installed
# even when NODE_ENV=production
cd ui && npm install --include=dev && npm run build
