#!/bin/bash

# Script to test the MCP server locally

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to cleanup on exit
cleanup() {
    if [ ! -z "$SERVER_PID" ]; then
        echo -e "\n${YELLOW}Stopping server (PID: $SERVER_PID)...${NC}"
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        echo -e "${GREEN}Server stopped.${NC}"
    fi
}

# Set up trap to ensure cleanup happens
trap cleanup EXIT INT TERM

echo -e "${BLUE}=== MCP Server Local Testing ===${NC}\n"

# 1. Ask user for Databricks profile
read -p "Enter Databricks Profile (for authentication): " DATABRICKS_PROFILE
if [ -z "$DATABRICKS_PROFILE" ]; then
    echo -e "${RED}Error: Databricks Profile cannot be empty${NC}"
    exit 1
fi

# 2. Ask user for UC Connection Name
read -p "Enter UC Connection Name: " UC_CONNECTION_NAME
if [ -z "$UC_CONNECTION_NAME" ]; then
    echo -e "${RED}Error: UC Connection Name cannot be empty${NC}"
    exit 1
fi

# 3. Ask user for spec volume path
echo -e "\n${YELLOW}Enter spec volume path (format: /Volumes/<catalog>/<schema>/<volume>):${NC}"
read -p "Spec Volume Path: " SPEC_VOLUME_PATH
if [ -z "$SPEC_VOLUME_PATH" ]; then
    echo -e "${RED}Error: Spec volume path cannot be empty${NC}"
    exit 1
fi

# Validate volume path format
if [[ ! "$SPEC_VOLUME_PATH" =~ ^/Volumes/[^/]+/[^/]+/[^/]+ ]]; then
    echo -e "${RED}Error: Invalid volume path format. Expected: /Volumes/<catalog>/<schema>/<volume>${NC}"
    exit 1
fi

# 4. Ask user for spec file name
read -p "Enter Spec File Name (e.g., spec.json): " SPEC_FILE_NAME
if [ -z "$SPEC_FILE_NAME" ]; then
    echo -e "${RED}Error: Spec File Name cannot be empty${NC}"
    exit 1
fi

# 5. Export environment variables
export DATABRICKS_CONFIG_PROFILE="$DATABRICKS_PROFILE"
export UC_CONNECTION_NAME="$UC_CONNECTION_NAME"
export SPEC_VOLUME_PATH="$SPEC_VOLUME_PATH"
export SPEC_FILE_NAME="$SPEC_FILE_NAME"

echo -e "\n${GREEN}Environment variables set:${NC}"
echo -e "  DATABRICKS_CONFIG_PROFILE: ${DATABRICKS_PROFILE}"
echo -e "  UC_CONNECTION_NAME: ${UC_CONNECTION_NAME}"
echo -e "  SPEC_VOLUME_PATH: ${SPEC_VOLUME_PATH}"
echo -e "  SPEC_FILE_NAME: ${SPEC_FILE_NAME}"

# 6. Run uv sync and start the server
echo -e "\n${BLUE}Running uv sync...${NC}"
uv sync

echo -e "\n${BLUE}Starting MCP server...${NC}"
uv run custom-open-api-spec-server &
SERVER_PID=$!

echo -e "${GREEN}Server started (PID: $SERVER_PID)${NC}"

# Wait for server to be ready
echo -e "\n${YELLOW}Waiting for server to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://0.0.0.0:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}Server is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: Server failed to start within 30 seconds${NC}"
        exit 1
    fi
    echo -n "."
    sleep 1
done

# 7. Run the test script
echo -e "\n${BLUE}Running test script...${NC}\n"
echo -e "${BLUE}========================================${NC}\n"
uv run python scripts/dev/query_local.py
echo -e "\n${BLUE}========================================${NC}\n"

echo -e "${GREEN}Test completed successfully!${NC}"

# Cleanup will be called automatically due to trap

