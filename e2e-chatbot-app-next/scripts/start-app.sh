#!/bin/bash
set -e

echo "==================================================================="
echo "Starting Databricks Chatbot App"
echo "==================================================================="

# Install dependencies
echo "Installing dependencies..."
npm install

# Start app
echo "Starting app (npm run dev)..."
echo
echo "-------------------------------------------------------------------"
echo "App URLs:"
echo "  Frontend: http://localhost:3000  <-- Open this in your browser"
echo "  Backend:  http://localhost:3001"
echo "-------------------------------------------------------------------"
echo
npm run dev

