#!/bin/bash
set -e

# Print current directory and list files
echo "Current directory: $(pwd)"
echo "Listing files:"
ls -la

# Check if dist exists
if [ -d "dist" ]; then
  echo "dist directory found:"
  ls -la dist/
else
  echo "ERROR: dist directory not found!"
  exit 1
fi

# Start the server
exec node dist/src/server.js
