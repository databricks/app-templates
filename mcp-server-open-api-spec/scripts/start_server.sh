#!/bin/bash

# Script to start the MCP server

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Starting MCP Server ===${NC}\n"

# Sync dependencies
echo -e "${BLUE}Running uv sync...${NC}"
uv sync

echo -e "${GREEN}✓ Dependencies synced${NC}\n"

# Start the server
echo -e "${BLUE}Starting custom-open-api-spec-server...${NC}"
echo -e "${YELLOW}Server will run on http://0.0.0.0:8000${NC}"
echo -e "${YELLOW}Health check: http://0.0.0.0:8000/health${NC}"
echo -e "${YELLOW}MCP endpoint: http://0.0.0.0:8000/mcp${NC}\n"

uv run custom-open-api-spec-server

