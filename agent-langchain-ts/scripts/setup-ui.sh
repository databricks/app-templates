#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

UI_DIR="../e2e-chatbot-app-next"
UI_WORKSPACE_PATH="./ui"

echo -e "${GREEN}🔧 Setting up Chat UI...${NC}"

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

# Clone the repo
TEMP_DIR=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/databricks/app-templates.git "$TEMP_DIR"

cd "$TEMP_DIR"
git sparse-checkout set e2e-chatbot-app-next

# Move UI to workspace location
cd -
mv "$TEMP_DIR/e2e-chatbot-app-next" "$UI_WORKSPACE_PATH"
rm -rf "$TEMP_DIR"

echo -e "${GREEN}✓ UI cloned successfully${NC}"

# Copy custom exports to UI server
echo -e "${YELLOW}Adding custom routes to UI server...${NC}"
EXPORTS_SOURCE="./ui-patches/exports.ts"
EXPORTS_DEST="$UI_WORKSPACE_PATH/server/src/exports.ts"

if [ -f "$EXPORTS_SOURCE" ]; then
    cp "$EXPORTS_SOURCE" "$EXPORTS_DEST"
    echo -e "${GREEN}✓ Custom exports copied${NC}"
fi

# Patch UI server to load custom exports
UI_SERVER_INDEX="$UI_WORKSPACE_PATH/server/src/index.ts"

if [ -f "$UI_SERVER_INDEX" ]; then
    # Add import and call to exports at the end of the file, before server start
    sed -i.bak '/^async function startServer()/i\
// Load custom routes if exports file exists\
try {\
  const { addCustomRoutes } = await import(\"./exports.js\");\
  addCustomRoutes(app);\
} catch (error) {\
  // exports.ts does not exist or failed to load, skip\
}\
' "$UI_SERVER_INDEX"

    rm -f "${UI_SERVER_INDEX}.bak"
    echo -e "${GREEN}✓ UI server patched to load custom routes${NC}"
else
    echo -e "${YELLOW}⚠️  UI server index.ts not found, skipping patch${NC}"
fi

echo -e "${GREEN}✓ Setup complete!${NC}"
