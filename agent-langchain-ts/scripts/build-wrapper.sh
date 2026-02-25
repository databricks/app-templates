#!/bin/bash
# Build wrapper that skips if dist folders already exist (for pre-built deployments)

if [ -d "dist" ] && [ -d "ui/client/dist" ] && [ -d "ui/server/dist" ]; then
  echo "✓ Using pre-built artifacts (dist folders found)"
  echo "  - dist/"
  echo "  - ui/client/dist/"
  echo "  - ui/server/dist/"
  exit 0
fi

echo "Building from source..."
bash scripts/setup-ui.sh && npm run build:agent && npm run build:ui
