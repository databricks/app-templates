#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_LOCAL_FILE="$PROJECT_ROOT/.env.local"
ENV_EXAMPLE_FILE="$PROJECT_ROOT/.env.example"
DATABRICKS_YML="$PROJECT_ROOT/databricks.yml"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Databricks E2E Chatbot - Local Development Setup Wizard  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# 1. Prerequisites Check
# ============================================
echo -e "${BLUE}Checking prerequisites...${NC}"

# Check if databricks CLI is installed
if ! command -v databricks &> /dev/null; then
  echo -e "${RED}✗ Databricks CLI is not installed.${NC}"
  echo -e "  Please install it from: https://docs.databricks.com/dev-tools/cli/install.html"
  exit 1
fi
echo -e "${GREEN}✓ Databricks CLI found${NC}"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo -e "${RED}✗ jq is not installed.${NC}"
  echo -e "  Please install it: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi
echo -e "${GREEN}✓ jq found${NC}"

# Check if user is authenticated
if ! databricks auth describe &> /dev/null; then
  echo -e "${RED}✗ Not authenticated with Databricks.${NC}"
  echo -e "  Please run: databricks auth login [--profile name]"
  exit 1
fi
echo -e "${GREEN}✓ Databricks authentication verified${NC}"
echo ""

# ============================================
# 2. Check if .env.local already exists
# ============================================
if [[ -f "$ENV_LOCAL_FILE" ]]; then
  echo -e "${YELLOW}Warning: .env.local already exists.${NC}"
  read -p "Do you want to overwrite it? (y/n): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Setup cancelled.${NC}"
    exit 0
  fi
  echo ""
fi

# ============================================
# 3. Wizard-Style Configuration
# ============================================
echo -e "${BLUE}Let's configure your local development environment!${NC}"
echo ""

# A. DATABRICKS_CONFIG_PROFILE
echo -e "${GREEN}[1/3] Databricks Config Profile${NC}"
echo "The profile you used with 'databricks auth login [--profile name]'"
read -p "Enter your Databricks config profile name (press Enter for 'DEFAULT'): " CONFIG_PROFILE
CONFIG_PROFILE=${CONFIG_PROFILE:-DEFAULT}
echo ""

# B. DATABRICKS_HOST
echo -e "${GREEN}[2/3] Databricks Workspace URL${NC}"
DETECTED_HOST=$(databricks auth describe --output json 2>/dev/null | jq -r '.host' || echo "")
if [[ -n "$DETECTED_HOST" && "$DETECTED_HOST" != "null" ]]; then
  echo "Detected workspace URL: $DETECTED_HOST"
  read -p "Use this URL? (Y/n): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    read -p "Enter your Databricks workspace URL (e.g., https://your-workspace.cloud.databricks.com): " DATABRICKS_HOST
  else
    DATABRICKS_HOST="$DETECTED_HOST"
  fi
else
  read -p "Enter your Databricks workspace URL (e.g., https://your-workspace.cloud.databricks.com): " DATABRICKS_HOST
fi
echo ""

# C. DATABRICKS_SERVING_ENDPOINT
echo -e "${GREEN}[3/3] Databricks Serving Endpoint${NC}"
echo "The name of your agent or model serving endpoint"
read -p "Enter your Databricks serving endpoint name: " SERVING_ENDPOINT
while [[ -z "$SERVING_ENDPOINT" ]]; do
  echo -e "${RED}Serving endpoint name is required.${NC}"
  read -p "Enter your Databricks serving endpoint name: " SERVING_ENDPOINT
done
echo ""

# ============================================
# 4. Database Configuration Detection
# ============================================
echo -e "${BLUE}Checking for database configuration...${NC}"

DATABASE_ENABLED=false

# Check if both database sections are uncommented in databricks.yml
if [[ -f "$DATABRICKS_YML" ]]; then
  # Check for Section 1: database_instances.chatbot_lakebase (line should start with spaces and chatbot_lakebase:)
  if grep -q "^[[:space:]]*chatbot_lakebase:" "$DATABRICKS_YML"; then
    # Check for Section 2: database resource binding (line should start with spaces, dash, and "name: database")
    if grep -q "^[[:space:]]*-[[:space:]]*name:[[:space:]]*database" "$DATABRICKS_YML"; then
      DATABASE_ENABLED=true
      echo -e "${GREEN}✓ Database is enabled in databricks.yml${NC}"
    fi
  fi
fi

if [[ "$DATABASE_ENABLED" == "false" ]]; then
  echo -e "${YELLOW}✓ Database is not enabled (ephemeral mode)${NC}"
  echo "  To enable persistent chat history, uncomment the database sections in databricks.yml"
fi
echo ""

# ============================================
# 5. Database Setup (if enabled)
# ============================================
PGUSER=""
PGHOST=""
PGDATABASE="databricks_postgres"
PGPORT="5432"

if [[ "$DATABASE_ENABLED" == "true" ]]; then
  echo -e "${BLUE}Configuring database connection...${NC}"

  # A. PGUSER - auto-detect
  PGUSER=$(databricks auth describe --output json 2>/dev/null | jq -r '.username' || echo "")
  if [[ -n "$PGUSER" && "$PGUSER" != "null" ]]; then
    echo -e "${GREEN}✓ Database user (PGUSER): $PGUSER${NC}"
  else
    echo -e "${YELLOW}⚠ Could not auto-detect database user${NC}"
    read -p "Enter your database username: " PGUSER
  fi

  # B. PGHOST - auto-detect with override option
  echo ""
  echo "Detecting database host..."
  DETECTED_PGHOST=""
  if [[ -x "$SCRIPT_DIR/get-pghost.sh" ]]; then
    DETECTED_PGHOST=$("$SCRIPT_DIR/get-pghost.sh" 2>/dev/null || echo "")
  fi

  if [[ -n "$DETECTED_PGHOST" && "$DETECTED_PGHOST" != "null" ]]; then
    echo "Detected database host: $DETECTED_PGHOST"
    read -p "Use this host? (Y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      read -p "Enter your database host (from Lakebase instance): " PGHOST
    else
      PGHOST="$DETECTED_PGHOST"
    fi
  else
    echo -e "${YELLOW}⚠ Could not auto-detect database host${NC}"
    echo "You can get this value by running: ./scripts/get-pghost.sh"
    read -p "Enter your database host (from Lakebase instance): " PGHOST
  fi

  echo ""
  echo -e "${GREEN}✓ Database configuration complete${NC}"
  echo "  PGDATABASE: $PGDATABASE (default)"
  echo "  PGPORT: $PGPORT (default)"
  echo ""
fi

# ============================================
# 6. Write .env.local
# ============================================
echo -e "${BLUE}Creating .env.local file...${NC}"

cat > "$ENV_LOCAL_FILE" << EOF
# ============================================
# Databricks Auth Configuration
# ============================================
# Generated by setup-local-dev-env.sh on $(date)
DATABRICKS_CONFIG_PROFILE=$CONFIG_PROFILE
DATABRICKS_HOST=$DATABRICKS_HOST

# ============================================
# Agent Serving Configuration
# ============================================
DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT
EOF

# Add database configuration if enabled
if [[ "$DATABASE_ENABLED" == "true" && -n "$PGUSER" && -n "$PGHOST" ]]; then
  cat >> "$ENV_LOCAL_FILE" << EOF

# ============================================
# Database Configuration
# ============================================
# Using individual PG* variables (recommended for local development)
PGUSER=$PGUSER
PGHOST=$PGHOST
PGDATABASE=$PGDATABASE
PGPORT=$PGPORT
EOF
else
  cat >> "$ENV_LOCAL_FILE" << EOF

# ============================================
# Database Configuration
# ============================================
# Database is not enabled. The app will run in ephemeral mode (chat history
# stored in memory and lost on restart).
#
# To enable persistent chat history:
# 1. Uncomment both database sections in databricks.yml
# 2. Re-run this setup script
#
# Alternatively, you can manually set these variables:
# PGUSER=your-databricks-username
# PGHOST=your-postgres-host
# PGDATABASE=databricks_postgres
# PGPORT=5432
EOF
fi

echo -e "${GREEN}✓ .env.local has been created successfully!${NC}"
echo ""

# ============================================
# 7. Success Message & Next Steps
# ============================================
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete! 🎉                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo -e "  1️⃣  Start the development server:"
echo -e "     ${YELLOW}npm run dev${NC}"
echo ""

if [[ "$DATABASE_ENABLED" == "true" ]]; then
  echo -e "  2️⃣  Set up the database (first time only):"
  echo -e "     ${YELLOW}npm run db:migrate${NC}"
  echo ""
  echo -e "  3️⃣  Open your browser to:"
  echo -e "     ${YELLOW}http://localhost:3000${NC}"
else
  echo -e "  2️⃣  Open your browser to:"
  echo -e "     ${YELLOW}http://localhost:3000${NC}"
  echo ""
  echo -e "  💡 ${BLUE}Tip:${NC} To enable persistent chat history, uncomment the database"
  echo -e "     sections in databricks.yml and re-run this script."
fi
echo ""
