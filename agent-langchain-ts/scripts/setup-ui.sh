#!/bin/bash
set -e

# This script fetches the e2e-chatbot-app-next UI template if not already present.
# No patching is needed - the UI natively supports proxying /invocations via API_PROXY.

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

UI_DIR="../e2e-chatbot-app-next"
UI_WORKSPACE_PATH="./ui"

echo -e "${GREEN}🔧 Fetching Chat UI template...${NC}"

# Check if UI exists at workspace location
if [ -d "$UI_WORKSPACE_PATH" ]; then
    echo -e "${GREEN}✓ UI already exists at $UI_WORKSPACE_PATH${NC}"
    exit 0
fi

# Check if UI exists as sibling directory (typical monorepo setup)
if [ -d "$UI_DIR" ]; then
    echo -e "${GREEN}✓ Found UI at $UI_DIR${NC}"
    echo -e "${YELLOW}Creating symlink to workspace location...${NC}"
    ln -s "$UI_DIR" "$UI_WORKSPACE_PATH"
    echo -e "${GREEN}✓ Symlink created${NC}"
    exit 0
fi

# UI not found - clone it
echo -e "${YELLOW}UI not found. Cloning app-templates...${NC}"

# Clone the repo with the feature branch
TEMP_DIR=$(mktemp -d)
UI_BRANCH="${UI_BRANCH:-feature/plugin-system}"  # Allow override via env var
UI_REPO="${UI_REPO:-https://github.com/smurching/app-templates.git}"  # Use fork for feature branch

echo -e "${YELLOW}Using branch: $UI_BRANCH${NC}"
echo -e "${YELLOW}Using repo: $UI_REPO${NC}"

git clone --depth 1 --filter=blob:none --sparse \
    --branch "$UI_BRANCH" \
    "$UI_REPO" "$TEMP_DIR"

cd "$TEMP_DIR"
git sparse-checkout set e2e-chatbot-app-next

# Move UI to workspace location
cd -
mv "$TEMP_DIR/e2e-chatbot-app-next" "$UI_WORKSPACE_PATH"
rm -rf "$TEMP_DIR"

echo -e "${GREEN}✓ UI cloned successfully${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo -e ""
echo -e "${YELLOW}Note: The UI will proxy /invocations requests to the agent backend${NC}"
echo -e "${YELLOW}Set API_PROXY environment variable to configure the agent URL${NC}"
