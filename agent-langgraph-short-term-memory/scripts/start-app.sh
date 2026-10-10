#!/bin/bash

# Load environment variables from .env.local if it exists
if [ -f ".env.local" ]; then
    echo "Loading environment variables from .env.local..."
    export $(cat .env.local | grep -v '^#' | xargs)
fi

# Create FIFO early for process exit detection
FIFO=$(mktemp -u)
mkfifo "$FIFO"

# Start backend in background - writes to FIFO on exit
echo "Starting backend..."
{ uv run start-server 2>&1 | tee backend.log; echo "backend ${PIPESTATUS[0]}" > "$FIFO"; } &
BACKEND_PID=$!

# Check if e2e-chatbot-app-next exists, if not clone it
if [ ! -d "e2e-chatbot-app-next" ]; then
    echo "Cloning e2e-chatbot-app-next..."
    
    # Try HTTPS first, then SSH as fallback
    if git clone --filter=blob:none --sparse https://github.com/databricks/app-templates.git temp-app-templates 2>/dev/null; then
        echo "Cloned using HTTPS"
    elif git clone --filter=blob:none --sparse git@github.com:databricks/app-templates.git temp-app-templates 2>/dev/null; then
        echo "Cloned using SSH"
    else
        echo "ERROR: Failed to clone repository."
        echo "Please manually download the folder by going to the following link:"
        echo "  https://download-directory.github.io/?url=https://github.com/databricks/app-templates/tree/main/e2e-chatbot-app-next"
        echo "Then unzip it in this directory and re-run \`./scripts/start-app.sh\`."
        exit 1
    fi
    
    cd temp-app-templates
    git sparse-checkout set e2e-chatbot-app-next
    cd ..
    mv temp-app-templates/e2e-chatbot-app-next .
    rm -rf temp-app-templates
fi

# Start frontend in background - writes to FIFO on exit
echo "Starting frontend..."
cd e2e-chatbot-app-next
npm install
npm run build
{ npm run start 2>&1 | tee ../frontend.log; echo "frontend ${PIPESTATUS[0]}" > "$FIFO"; } &
FRONTEND_PID=$!
cd ..

# Function to cleanup processes on script exit
cleanup() {
    echo ""
    echo "=========================================="
    echo "Shutting down both processes..."
    echo "=========================================="
    # Kill child processes first, then the wrapper subshells
    pkill -P $BACKEND_PID 2>/dev/null
    pkill -P $FRONTEND_PID 2>/dev/null
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    rm -f "$FIFO" 2>/dev/null
}

# Function to print error logs
print_error_logs() {
    echo ""
    echo "Last 50 lines of backend.log:"
    echo "----------------------------------------"
    tail -50 backend.log 2>/dev/null || echo "(no backend.log found)"
    echo "----------------------------------------"
    echo ""
    echo "Last 50 lines of frontend.log:"
    echo "----------------------------------------"
    tail -50 frontend.log 2>/dev/null || echo "(no frontend.log found)"
    echo "----------------------------------------"
}

# Trap cleanup function on script termination
trap cleanup SIGINT

# Monitor both processes
echo ""
echo "Both processes started. Monitoring for failures..."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""

# Block until first process exits (reads from FIFO)
read RESULT < "$FIFO"
rm -f "$FIFO"

FAILED=$(echo "$RESULT" | cut -d' ' -f1)
EXIT_CODE=$(echo "$RESULT" | cut -d' ' -f2)

echo ""
echo "=========================================="
echo "ERROR: $FAILED process exited with code $EXIT_CODE"
echo "=========================================="
print_error_logs
cleanup
exit $EXIT_CODE

