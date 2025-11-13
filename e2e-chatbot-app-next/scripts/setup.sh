#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Databricks E2E Chatbot - Interactive Setup Wizard
# ============================================
#
# This comprehensive wizard guides you through:
# - Prerequisites verification
# - Databricks authentication
# - Initial deployment configuration
# - Database enablement
# - Local development setup
# - Diagnostics and troubleshooting
#
# Usage: ./scripts/setup.sh

# ============================================
# Constants and Configuration
# ============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABRICKS_YML="$PROJECT_ROOT/databricks.yml"
ENV_LOCAL_FILE="$PROJECT_ROOT/.env.local"
ENV_EXAMPLE_FILE="$PROJECT_ROOT/.env.example"
STATE_FILE="$HOME/.databricks-chatbot-setup-state"

# State variables
CURRENT_STEP=""
WORKSPACE_URL=""
SERVING_ENDPOINT=""
DEPLOY_TARGET="dev"
DATABASE_MODE="ephemeral"
CONFIG_PROFILE="DEFAULT"

# ============================================
# Interactive Menu System
# ============================================

# Read a single keypress (including arrow keys)
read_key() {
  local key
  # Read one character at a time
  IFS= read -rsn1 key

  # Check for escape sequence (arrow keys)
  if [[ $key == $'\x1b' ]]; then
    # Read the next two characters to get the full escape sequence
    read -rsn2 -t 0.1 rest 2>/dev/null || rest=""
    key="$key$rest"

    case $key in
      $'\x1b[A') echo "UP" ;;
      $'\x1b[B') echo "DOWN" ;;
      *) echo "ESC" ;;
    esac
  elif [[ $key == "" ]]; then
    echo "ENTER"
  elif [[ $key == "q" ]] || [[ $key == "Q" ]]; then
    echo "QUIT"
  else
    echo "$key"
  fi
}

# Render menu with selection indicator
render_menu() {
  local title="$1"
  shift
  local items=("$@")
  local selected="${MENU_SELECTED:-0}"

  clear
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║${BOLD}  $title${NC}${BLUE}$(printf '%*s' $((57 - ${#title})) '')║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  for i in "${!items[@]}"; do
    if [[ $i -eq $selected ]]; then
      echo -e "${GREEN}${BOLD}  ▶ [$i] ${items[$i]}${NC}"
    else
      echo -e "    [$i] ${items[$i]}"
    fi
  done

  echo ""
  echo -e "${CYAN}Use ↑/↓ arrows or numbers [0-$((${#items[@]} - 1))], Enter to select, Q to quit${NC}"
}

# Show menu and get selection
show_menu() {
  local title="$1"
  shift
  local items=("$@")
  local selected=0
  local num_items=${#items[@]}

  while true; do
    MENU_SELECTED=$selected
    render_menu "$title" "${items[@]}"

    local key=$(read_key)

    case $key in
      UP)
        ((selected--))
        if [[ $selected -lt 0 ]]; then
          selected=$((num_items - 1))
        fi
        ;;
      DOWN)
        ((selected++))
        if [[ $selected -ge $num_items ]]; then
          selected=0
        fi
        ;;
      ENTER)
        echo "$selected"
        return 0
        ;;
      QUIT)
        echo "quit"
        return 1
        ;;
      [0-9])
        # Allow direct number selection
        if [[ $key -lt $num_items ]]; then
          echo "$key"
          return 0
        fi
        ;;
    esac
  done
}

# ============================================
# Utility Functions
# ============================================

# Print with colors
print_info() {
  echo -e "${BLUE}ℹ${NC}  $1"
}

print_success() {
  echo -e "${GREEN}✓${NC}  $1"
}

print_error() {
  echo -e "${RED}✗${NC}  $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC}  $1"
}

print_step() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━ $1 ━━━${NC}"
  echo ""
}

# Progress spinner
show_spinner() {
  local pid=$1
  local message="${2:-Working...}"
  local delay=0.1
  local spinstr='⣾⣽⣻⢿⡿⣟⣯⣷'

  while kill -0 $pid 2>/dev/null; do
    local temp=${spinstr#?}
    printf "\r${CYAN}%s${NC} [%c]  " "$message" "$spinstr"
    local spinstr=$temp${spinstr%"$temp"}
    sleep $delay
  done
  printf "\r%*s\r" $((${#message} + 10)) ""
}

# Prompt for input with default
prompt_input() {
  local prompt="$1"
  local default="${2:-}"
  local var_name="$3"

  if [[ -n "$default" ]]; then
    read -p "$(echo -e "${CYAN}${prompt}${NC} [${default}]: ")" input
    input="${input:-$default}"
  else
    read -p "$(echo -e "${CYAN}${prompt}${NC}: ")" input
  fi

  eval "$var_name='$input'"
}

# Confirm action
confirm() {
  local prompt="$1"
  local default="${2:-y}"

  if [[ "$default" == "y" ]]; then
    read -p "$(echo -e "${CYAN}${prompt}${NC} (Y/n): ")" -n 1 -r
  else
    read -p "$(echo -e "${CYAN}${prompt}${NC} (y/N): ")" -n 1 -r
  fi
  echo ""

  if [[ -z "$REPLY" ]]; then
    [[ "$default" == "y" ]]
  else
    [[ $REPLY =~ ^[Yy]$ ]]
  fi
}

# Save state
save_state() {
  cat > "$STATE_FILE" << EOF
WORKSPACE_URL="$WORKSPACE_URL"
SERVING_ENDPOINT="$SERVING_ENDPOINT"
DEPLOY_TARGET="$DEPLOY_TARGET"
DATABASE_MODE="$DATABASE_MODE"
CONFIG_PROFILE="$CONFIG_PROFILE"
CURRENT_STEP="$CURRENT_STEP"
EOF
}

# Load state
load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    source "$STATE_FILE"
    return 0
  fi
  return 1
}

# ============================================
# Prerequisites Functions
# ============================================

check_nodejs() {
  if command -v node &> /dev/null; then
    local version=$(node --version)
    print_success "Node.js installed: $version"
    return 0
  else
    print_error "Node.js is not installed"
    echo "  Install from: https://nodejs.org/"
    return 1
  fi
}

check_npm() {
  if command -v npm &> /dev/null; then
    local version=$(npm --version)
    print_success "npm installed: v$version"
    return 0
  else
    print_error "npm is not installed"
    return 1
  fi
}

check_databricks_cli() {
  if command -v databricks &> /dev/null; then
    local version=$(databricks --version 2>&1 || echo "unknown")
    print_success "Databricks CLI installed: $version"

    # Check if version is recent enough
    local ver_num=$(echo "$version" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n "$ver_num" ]]; then
      local major=$(echo "$ver_num" | cut -d. -f1)
      if [[ $major -lt 1 ]]; then
        print_warning "Databricks CLI version may be outdated. Consider upgrading:"
        echo "  brew upgrade databricks"
      fi
    fi
    return 0
  else
    print_error "Databricks CLI is not installed"
    echo ""
    echo "Install with:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      echo "  brew install databricks"
    else
      echo "  Visit: https://docs.databricks.com/dev-tools/cli/install.html"
    fi
    return 1
  fi
}

check_jq() {
  if command -v jq &> /dev/null; then
    local version=$(jq --version)
    print_success "jq installed: $version"
    return 0
  else
    print_error "jq is not installed"
    echo ""
    echo "Install with:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      echo "  brew install jq"
    else
      echo "  apt-get install jq (Ubuntu/Debian)"
      echo "  yum install jq (CentOS/RHEL)"
    fi
    return 1
  fi
}

check_git() {
  if command -v git &> /dev/null; then
    local version=$(git --version)
    print_success "git installed: $version"
    return 0
  else
    print_error "git is not installed"
    return 1
  fi
}

check_all_prerequisites() {
  print_step "Checking Prerequisites"

  local all_good=true

  check_nodejs || all_good=false
  check_npm || all_good=false
  check_databricks_cli || all_good=false
  check_jq || all_good=false
  check_git || all_good=false

  echo ""

  if [[ "$all_good" == "true" ]]; then
    print_success "All prerequisites are met!"
    return 0
  else
    print_error "Some prerequisites are missing. Please install them and try again."
    return 1
  fi
}

# ============================================
# Authentication Functions
# ============================================

check_databricks_auth() {
  if databricks auth describe &> /dev/null; then
    local username=$(databricks auth describe --output json 2>/dev/null | jq -r '.username' || echo "unknown")
    local host=$(databricks auth describe --output json 2>/dev/null | jq -r '.host' || echo "unknown")
    print_success "Authenticated as: $username"
    print_info "Workspace: $host"
    WORKSPACE_URL="$host"
    return 0
  else
    print_error "Not authenticated with Databricks"
    return 1
  fi
}

setup_databricks_auth() {
  print_step "Configure Databricks Authentication"

  if check_databricks_auth; then
    echo ""
    if confirm "Already authenticated. Re-authenticate?" "n"; then
      setup_auth_interactive
    fi
  else
    setup_auth_interactive
  fi
}

setup_auth_interactive() {
  echo ""
  print_info "Databricks authentication uses CLI profiles"
  print_info "You can have multiple profiles for different workspaces"
  echo ""

  prompt_input "Enter profile name" "$CONFIG_PROFILE" "CONFIG_PROFILE"

  echo ""
  print_info "Running: databricks auth login --profile $CONFIG_PROFILE"
  print_info "A browser window will open for authentication..."
  echo ""

  if databricks auth login --profile "$CONFIG_PROFILE"; then
    print_success "Authentication successful!"

    # Update environment if using non-default profile
    if [[ "$CONFIG_PROFILE" != "DEFAULT" ]]; then
      export DATABRICKS_CONFIG_PROFILE="$CONFIG_PROFILE"
    fi

    # Get workspace URL
    WORKSPACE_URL=$(databricks auth describe --output json 2>/dev/null | jq -r '.host' || echo "")
    if [[ -n "$WORKSPACE_URL" ]]; then
      print_success "Connected to workspace: $WORKSPACE_URL"
    fi

    save_state
    return 0
  else
    print_error "Authentication failed"
    return 1
  fi
}

# ============================================
# Configuration Functions
# ============================================

check_databricks_yml() {
  if [[ ! -f "$DATABRICKS_YML" ]]; then
    print_error "databricks.yml not found at: $DATABRICKS_YML"
    return 1
  fi
  return 0
}

check_serving_endpoint_configured() {
  if grep -q "^    # default:" "$DATABRICKS_YML"; then
    return 1
  fi
  return 0
}

check_database_enabled() {
  if grep -q "^[[:space:]]*chatbot_lakebase:" "$DATABRICKS_YML"; then
    if grep -q "^[[:space:]]*-[[:space:]]*name:[[:space:]]*database" "$DATABRICKS_YML"; then
      return 0
    fi
  fi
  return 1
}

configure_serving_endpoint() {
  print_step "Configure Serving Endpoint"

  print_info "This is the name of your Databricks AI serving endpoint"
  print_info "It should be an Agent Bricks endpoint or custom agent"
  echo ""

  local current_endpoint=""
  if grep -q "default:" "$DATABRICKS_YML"; then
    current_endpoint=$(grep "default:" "$DATABRICKS_YML" | head -1 | sed 's/.*default:[[:space:]]*//' | tr -d '"')
    if [[ -n "$current_endpoint" && "$current_endpoint" != "your-serving-endpoint-name-goes-here" ]]; then
      print_info "Current endpoint: $current_endpoint"
    fi
  fi

  prompt_input "Enter serving endpoint name" "${SERVING_ENDPOINT:-$current_endpoint}" "SERVING_ENDPOINT"

  if [[ -z "$SERVING_ENDPOINT" ]]; then
    print_error "Serving endpoint name is required"
    return 1
  fi

  # Update databricks.yml
  cp "$DATABRICKS_YML" "$DATABRICKS_YML.bak"

  # Uncomment and set the default value
  sed -i.tmp '
    /serving_endpoint_name:/,/# default:/ {
      /# default:/ {
        s|# default:.*|default: "'"$SERVING_ENDPOINT"'"|
      }
    }
  ' "$DATABRICKS_YML"

  rm -f "$DATABRICKS_YML.tmp"

  print_success "Serving endpoint configured: $SERVING_ENDPOINT"
  save_state
  return 0
}

choose_database_mode() {
  print_step "Choose Database Mode"

  echo "The chatbot can run in two modes:"
  echo ""
  echo -e "${GREEN}Persistent Mode (with Database):${NC}"
  echo "  • Chat history is saved to Postgres/Lakebase"
  echo "  • Conversations persist across sessions"
  echo "  • Users can access their chat history"
  echo "  • Requires database deployment (~5-10 minutes first time)"
  echo ""
  echo -e "${YELLOW}Ephemeral Mode (without Database):${NC}"
  echo "  • Faster initial setup"
  echo "  • Chat history is lost on restart"
  echo "  • Good for testing and development"
  echo ""

  local choice
  choice=$(show_menu "Select Database Mode" \
    "💾 Persistent Mode (with Database)" \
    "⚡ Ephemeral Mode (without Database)" \
    "ℹ️  Learn More")

  case $choice in
    0)
      DATABASE_MODE="persistent"
      print_success "Selected: Persistent Mode"
      ;;
    1)
      DATABASE_MODE="ephemeral"
      print_success "Selected: Ephemeral Mode"
      ;;
    2)
      echo ""
      print_info "Database Mode Information:"
      echo ""
      echo "You can always enable the database later by:"
      echo "  1. Running this wizard again"
      echo "  2. Manually editing databricks.yml"
      echo ""
      read -p "Press Enter to continue..."
      choose_database_mode
      return $?
      ;;
    quit)
      return 1
      ;;
  esac

  save_state
  return 0
}

enable_database_in_yml() {
  print_step "Enabling Database in databricks.yml"

  if check_database_enabled; then
    print_success "Database is already enabled"
    return 0
  fi

  cp "$DATABRICKS_YML" "$DATABRICKS_YML.bak"
  print_info "Created backup: databricks.yml.bak"

  # Section 1: Uncomment database_instances.chatbot_lakebase
  sed -i.tmp '
    /database_instances:/,/capacity: CU_1/ {
      /# TODO (optional): Uncomment the database resource below to deploy the app with a database/d
      s/^    # chatbot_lakebase:/    chatbot_lakebase:/
      s/^    #   /      /
    }
  ' "$DATABRICKS_YML"

  # Section 2: Uncomment database resource binding
  sed -i.tmp '
    /# TODO (optional): Uncomment the database resource below to bind the app/,/permission: CAN_CONNECT_AND_CREATE/ {
      /# TODO (optional): Uncomment the database resource below/d
      /# and to enable persistent chat history/d
      s/^        # /        /
    }
  ' "$DATABRICKS_YML"

  rm -f "$DATABRICKS_YML.tmp"

  if check_database_enabled; then
    print_success "Database enabled in databricks.yml"
    return 0
  else
    print_error "Failed to enable database. Restoring backup..."
    mv "$DATABRICKS_YML.bak" "$DATABRICKS_YML"
    return 1
  fi
}

# ============================================
# Deployment Functions
# ============================================

choose_deployment_target() {
  print_step "Choose Deployment Target"

  echo "Deployment targets:"
  echo ""
  echo -e "${GREEN}dev:${NC} Development environment (user-scoped)"
  echo -e "${YELLOW}staging:${NC} Staging environment (shared)"
  echo -e "${CYAN}prod:${NC} Production environment"
  echo ""

  local choice
  choice=$(show_menu "Select Deployment Target" \
    "🔧 dev (Development)" \
    "🧪 staging (Staging)" \
    "🚀 prod (Production)")

  case $choice in
    0)
      DEPLOY_TARGET="dev"
      ;;
    1)
      DEPLOY_TARGET="staging"
      ;;
    2)
      DEPLOY_TARGET="prod"
      ;;
    quit)
      return 1
      ;;
  esac

  print_success "Selected target: $DEPLOY_TARGET"
  save_state
  return 0
}

validate_bundle() {
  print_step "Validating Bundle Configuration"

  if databricks bundle validate 2>&1 | tee /tmp/bundle-validate.log; then
    print_success "Bundle configuration is valid"
    return 0
  else
    print_error "Bundle validation failed"
    echo ""
    echo "Review the errors above and:"
    echo "  1. Check databricks.yml for syntax errors"
    echo "  2. Ensure serving endpoint name is set"
    echo "  3. Verify Databricks CLI version is up to date"
    return 1
  fi
}

deploy_bundle() {
  print_step "Deploying Bundle (target: $DEPLOY_TARGET)"

  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    print_warning "First deployment with database may take 5-10 minutes..."
  fi

  echo ""
  print_info "Running: databricks bundle deploy -t $DEPLOY_TARGET"
  echo ""

  if databricks bundle deploy -t "$DEPLOY_TARGET"; then
    echo ""
    print_success "Bundle deployed successfully!"
    return 0
  else
    echo ""
    print_error "Bundle deployment failed"
    return 1
  fi
}

get_database_instance_name() {
  if [[ "$DEPLOY_TARGET" == "dev" ]]; then
    local username=$(databricks auth describe --output json 2>/dev/null | jq -r '.username')
    local domain_friendly=$(echo "$username" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
    echo "chatbot-lakebase-dev-$domain_friendly"
  elif [[ "$DEPLOY_TARGET" == "staging" ]]; then
    echo "chatbot-lakebase-staging"
  elif [[ "$DEPLOY_TARGET" == "prod" ]]; then
    echo "chatbot-lakebase-prod"
  fi
}

wait_for_database() {
  local db_instance_name="$1"

  print_step "Waiting for Database to be Ready"

  print_info "Database instance: $db_instance_name"
  echo ""

  local retries=0
  local max_retries=30

  while [[ $retries -lt $max_retries ]]; do
    local pghost=$(databricks database get-database-instance "$db_instance_name" 2>/dev/null | jq -r '.read_write_dns' || echo "")

    if [[ -n "$pghost" && "$pghost" != "null" ]]; then
      print_success "Database is ready!"
      print_info "PGHOST: $pghost"
      echo "$pghost"
      return 0
    fi

    retries=$((retries + 1))
    if [[ $retries -lt $max_retries ]]; then
      echo -e "${CYAN}⏳${NC} Waiting... (attempt $retries/$max_retries)"
      sleep 10
    fi
  done

  print_warning "Database is not ready yet"
  print_info "You can check status with:"
  echo "  databricks database get-database-instance $db_instance_name"
  return 1
}

# ============================================
# Environment Functions
# ============================================

create_env_local() {
  print_step "Creating Local Environment File"

  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    print_warning ".env.local already exists"
    if ! confirm "Overwrite it?" "n"; then
      return 0
    fi
  fi

  # Detect values
  local pguser=$(databricks auth describe --output json 2>/dev/null | jq -r '.username' || echo "")
  local pghost=""

  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    local db_instance_name=$(get_database_instance_name)
    pghost=$(databricks database get-database-instance "$db_instance_name" 2>/dev/null | jq -r '.read_write_dns' || echo "")

    if [[ -z "$pghost" || "$pghost" == "null" ]]; then
      print_warning "Could not auto-detect PGHOST"
      if [[ -x "$SCRIPT_DIR/get-pghost.sh" ]]; then
        pghost=$("$SCRIPT_DIR/get-pghost.sh" 2>/dev/null || echo "")
      fi
    fi
  fi

  # Create file
  cat > "$ENV_LOCAL_FILE" << EOF
# ============================================
# Databricks Auth Configuration
# ============================================
# Generated by setup.sh on $(date)
DATABRICKS_CONFIG_PROFILE=$CONFIG_PROFILE
DATABRICKS_HOST=$WORKSPACE_URL

# ============================================
# Agent Serving Configuration
# ============================================
DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT
EOF

  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    cat >> "$ENV_LOCAL_FILE" << EOF

# ============================================
# Database Configuration
# ============================================
PGUSER=$pguser
PGHOST=${pghost:-your-postgres-host}
PGDATABASE=databricks_postgres
PGPORT=5432
EOF
  else
    cat >> "$ENV_LOCAL_FILE" << EOF

# ============================================
# Database Configuration
# ============================================
# Database is disabled (ephemeral mode)
# To enable persistent chat history, run: ./scripts/setup.sh
# and select "Enable Database"
EOF
  fi

  print_success "Created .env.local"

  if [[ "$DATABASE_MODE" == "persistent" && (-z "$pghost" || "$pghost" == "null") ]]; then
    print_warning "PGHOST could not be auto-detected"
    print_info "You can get it later with: ./scripts/get-pghost.sh"
  fi

  return 0
}

# ============================================
# Database Functions
# ============================================

run_migrations() {
  print_step "Running Database Migrations"

  if [[ ! -f "$ENV_LOCAL_FILE" ]]; then
    print_error ".env.local not found. Create it first."
    return 1
  fi

  print_info "This will create the required database tables"
  echo ""

  if npm run db:migrate; then
    print_success "Database migrations completed"
    return 0
  else
    print_error "Database migrations failed"
    print_info "Check that:"
    echo "  • Database is accessible"
    echo "  • PGHOST is set correctly in .env.local"
    echo "  • You have network connectivity"
    return 1
  fi
}

# ============================================
# Diagnostic Functions
# ============================================

check_installation_status() {
  print_step "Installation Status"

  echo -e "${BOLD}Prerequisites:${NC}"
  check_nodejs > /dev/null 2>&1 && print_success "Node.js" || print_error "Node.js"
  check_npm > /dev/null 2>&1 && print_success "npm" || print_error "npm"
  check_databricks_cli > /dev/null 2>&1 && print_success "Databricks CLI" || print_error "Databricks CLI"
  check_jq > /dev/null 2>&1 && print_success "jq" || print_error "jq"

  echo ""
  echo -e "${BOLD}Authentication:${NC}"
  check_databricks_auth > /dev/null 2>&1 && print_success "Authenticated" || print_error "Not authenticated"

  echo ""
  echo -e "${BOLD}Configuration:${NC}"
  [[ -f "$DATABRICKS_YML" ]] && print_success "databricks.yml exists" || print_error "databricks.yml not found"
  check_serving_endpoint_configured && print_success "Serving endpoint configured" || print_warning "Serving endpoint not configured"
  check_database_enabled && print_success "Database enabled" || print_info "Database disabled (ephemeral mode)"

  echo ""
  echo -e "${BOLD}Local Environment:${NC}"
  [[ -f "$ENV_LOCAL_FILE" ]] && print_success ".env.local exists" || print_warning ".env.local not found"
  [[ -d "$PROJECT_ROOT/node_modules" ]] && print_success "Dependencies installed" || print_warning "Dependencies not installed"

  echo ""
  read -p "Press Enter to continue..."
}

test_database_connection() {
  print_step "Test Database Connection"

  if [[ ! -f "$ENV_LOCAL_FILE" ]]; then
    print_error ".env.local not found"
    return 1
  fi

  source "$ENV_LOCAL_FILE"

  if [[ -z "$PGHOST" ]]; then
    print_error "PGHOST not set in .env.local"
    return 1
  fi

  print_info "Testing connection to: $PGHOST"
  echo ""

  # Try to connect using psql if available, otherwise use databricks CLI
  if command -v psql &> /dev/null; then
    if psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -p "$PGPORT" -c "SELECT 1" &> /dev/null; then
      print_success "Database connection successful!"
      return 0
    else
      print_error "Database connection failed"
      return 1
    fi
  else
    print_warning "psql not available, skipping connection test"
    print_info "Install PostgreSQL client to test connections"
    return 0
  fi
}

view_bundle_summary() {
  print_step "Bundle Deployment Summary"

  databricks bundle summary

  echo ""
  read -p "Press Enter to continue..."
}

show_help() {
  clear
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║${BOLD}                    Setup Wizard Help                       ${NC}${BLUE}║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}Complete First-Time Setup:${NC}"
  echo "  Guides you through the entire setup process from scratch."
  echo "  Recommended for new installations."
  echo ""
  echo -e "${BOLD}Check Prerequisites:${NC}"
  echo "  Verifies all required tools are installed and up to date."
  echo ""
  echo -e "${BOLD}Configure Authentication:${NC}"
  echo "  Sets up Databricks CLI authentication with your workspace."
  echo ""
  echo -e "${BOLD}Configure Deployment:${NC}"
  echo "  Configures databricks.yml with your serving endpoint and"
  echo "  database preferences, then deploys to Databricks."
  echo ""
  echo -e "${BOLD}Enable Database:${NC}"
  echo "  Adds persistent chat history support by enabling Lakebase"
  echo "  database. Can be done at any time."
  echo ""
  echo -e "${BOLD}Diagnostics & Troubleshooting:${NC}"
  echo "  Check status, test connections, and fix common issues."
  echo ""
  echo -e "${BOLD}Useful Resources:${NC}"
  echo "  • README.md - Complete documentation"
  echo "  • databricks.yml - Bundle configuration"
  echo "  • .env.example - Environment variable reference"
  echo ""
  read -p "Press Enter to return to main menu..."
}

# ============================================
# Main Workflows
# ============================================

complete_first_time_setup() {
  print_step "Complete First-Time Setup"

  echo "This wizard will guide you through:"
  echo "  1. Prerequisites verification"
  echo "  2. Databricks authentication"
  echo "  3. Project configuration"
  echo "  4. Deployment to Databricks"
  echo "  5. Local environment setup"
  echo ""
  print_info "Estimated time: 10-15 minutes"
  echo ""

  if ! confirm "Ready to begin?" "y"; then
    return 0
  fi

  # Step 1: Prerequisites
  if ! check_all_prerequisites; then
    print_error "Please install missing prerequisites and try again"
    read -p "Press Enter to continue..."
    return 1
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Step 2: Authentication
  setup_databricks_auth || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Step 3: Install dependencies
  print_step "Installing Dependencies"

  if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
    print_info "Installing npm packages..."
    if (cd "$PROJECT_ROOT" && npm install); then
      print_success "Dependencies installed"
    else
      print_error "Failed to install dependencies"
      return 1
    fi
  else
    print_success "Dependencies already installed"
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Step 4: Configure serving endpoint
  configure_serving_endpoint || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Step 5: Choose database mode
  choose_database_mode || return 1

  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    enable_database_in_yml || return 1
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Step 6: Choose deployment target
  choose_deployment_target || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Step 7: Validate and deploy
  validate_bundle || return 1

  echo ""
  if ! confirm "Ready to deploy?" "y"; then
    print_warning "Deployment skipped"
    return 0
  fi

  deploy_bundle || return 1

  # Step 8: Wait for database if enabled
  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    local db_instance_name=$(get_database_instance_name)
    wait_for_database "$db_instance_name"
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Step 9: Create .env.local
  create_env_local || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Step 10: Run migrations if database enabled
  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    if confirm "Run database migrations now?" "y"; then
      run_migrations
    fi
  fi

  # Step 11: Success!
  print_step "Setup Complete! 🎉"

  echo "Your chatbot is ready to use!"
  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo ""
  echo "  ${GREEN}For local development:${NC}"
  echo "    npm run dev"
  echo "    Open: http://localhost:3000"
  echo ""
  echo "  ${GREEN}For deployed app:${NC}"
  echo "    databricks bundle run databricks_chatbot"
  echo "    Check deployment: databricks bundle summary"
  echo ""

  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    echo "  ${GREEN}Database:${NC} Enabled (persistent chat history)"
  else
    echo "  ${YELLOW}Database:${NC} Disabled (ephemeral mode)"
    echo "    Enable anytime with: ./scripts/setup.sh"
  fi

  echo ""
  read -p "Press Enter to return to main menu..."
}

run_application() {
  local choice
  choice=$(show_menu "Run Application" \
    "💻 Start Local Development Server (npm run dev)" \
    "🚀 Start Deployed App (databricks bundle run)" \
    "🔙 Back to Main Menu")

  case $choice in
    0)
      print_step "Starting Local Development Server"
      echo ""
      print_info "Starting on http://localhost:3000"
      print_info "Press Ctrl+C to stop"
      echo ""
      cd "$PROJECT_ROOT" && npm run dev
      ;;
    1)
      print_step "Starting Deployed App"
      echo ""
      databricks bundle run databricks_chatbot
      echo ""
      read -p "Press Enter to continue..."
      ;;
    2|quit)
      return 0
      ;;
  esac
}

diagnostics_menu() {
  while true; do
    local choice
    choice=$(show_menu "Diagnostics & Troubleshooting" \
      "📊 Check Installation Status" \
      "🔌 Test Database Connection" \
      "📦 View Bundle Summary" \
      "📋 View Application Logs" \
      "🔧 Fix Common Issues" \
      "🔙 Back to Main Menu")

    case $choice in
      0)
        check_installation_status
        ;;
      1)
        test_database_connection
        echo ""
        read -p "Press Enter to continue..."
        ;;
      2)
        view_bundle_summary
        ;;
      3)
        print_step "Application Logs"
        print_info "View logs with: databricks apps logs databricks_chatbot"
        echo ""
        if confirm "View logs now?" "y"; then
          databricks apps logs databricks_chatbot
        fi
        echo ""
        read -p "Press Enter to continue..."
        ;;
      4)
        print_step "Common Issues and Fixes"
        echo ""
        echo "1. ${BOLD}Outdated Databricks CLI:${NC}"
        echo "   brew upgrade databricks"
        echo ""
        echo "2. ${BOLD}Bundle validation errors:${NC}"
        echo "   Check databricks.yml for TODOs"
        echo "   Ensure serving_endpoint_name is set"
        echo ""
        echo "3. ${BOLD}Database connection failed:${NC}"
        echo "   Wait for database provisioning to complete"
        echo "   Run: databricks database get-database-instance <name>"
        echo "   Update PGHOST in .env.local"
        echo ""
        echo "4. ${BOLD}Resource not found errors:${NC}"
        echo "   databricks bundle summary"
        echo "   databricks bundle unbind <resource-name>"
        echo ""
        read -p "Press Enter to continue..."
        ;;
      5|quit)
        return 0
        ;;
    esac
  done
}

enable_database_workflow() {
  print_step "Enable Persistent Chat History"

  if check_database_enabled; then
    print_success "Database is already enabled!"
    echo ""
    if ! confirm "Redeploy anyway?" "n"; then
      return 0
    fi
  fi

  echo ""
  echo "This will:"
  echo "  • Enable database in databricks.yml"
  echo "  • Deploy Lakebase instance (~5-10 minutes)"
  echo "  • Configure .env.local with database settings"
  echo "  • Run database migrations"
  echo ""

  if ! confirm "Continue?" "y"; then
    return 0
  fi

  # Enable in YAML
  enable_database_in_yml || return 1
  DATABASE_MODE="persistent"
  save_state

  echo ""
  read -p "Press Enter to continue..."

  # Choose target
  choose_deployment_target || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Validate and deploy
  validate_bundle || return 1

  echo ""
  if ! confirm "Ready to deploy?" "y"; then
    return 0
  fi

  deploy_bundle || return 1

  # Wait for database
  local db_instance_name=$(get_database_instance_name)
  local pghost=$(wait_for_database "$db_instance_name")

  echo ""
  read -p "Press Enter to continue..."

  # Update .env.local
  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    print_step "Updating .env.local"

    local pguser=$(databricks auth describe --output json 2>/dev/null | jq -r '.username' || echo "")

    if grep -q "^PGUSER=" "$ENV_LOCAL_FILE"; then
      # Update existing
      sed -i.bak "s|^PGUSER=.*|PGUSER=$pguser|" "$ENV_LOCAL_FILE"
      if [[ -n "$pghost" ]]; then
        sed -i.bak "s|^PGHOST=.*|PGHOST=$pghost|" "$ENV_LOCAL_FILE"
      fi
      rm -f "$ENV_LOCAL_FILE.bak"
    else
      # Append new
      cat >> "$ENV_LOCAL_FILE" << EOF

# ============================================
# Database Configuration
# ============================================
PGUSER=$pguser
PGHOST=${pghost:-your-postgres-host}
PGDATABASE=databricks_postgres
PGPORT=5432
EOF
    fi

    print_success "Updated .env.local"
  else
    create_env_local
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Run migrations
  if confirm "Run database migrations now?" "y"; then
    run_migrations
  fi

  echo ""
  print_success "Database enabled successfully! 💾"
  echo ""
  read -p "Press Enter to continue..."
}

configure_deployment_workflow() {
  print_step "Configure Deployment"

  # Configure serving endpoint
  configure_serving_endpoint || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Choose database mode
  if ! check_database_enabled; then
    if confirm "Enable database for persistent chat history?" "y"; then
      enable_database_in_yml || return 1
      DATABASE_MODE="persistent"
    else
      DATABASE_MODE="ephemeral"
    fi
    save_state
  else
    print_success "Database is already enabled"
    DATABASE_MODE="persistent"
  fi

  echo ""
  read -p "Press Enter to continue..."

  # Choose target
  choose_deployment_target || return 1

  echo ""
  read -p "Press Enter to continue..."

  # Validate
  validate_bundle || return 1

  echo ""
  if ! confirm "Deploy now?" "y"; then
    print_info "You can deploy later with:"
    echo "  databricks bundle deploy -t $DEPLOY_TARGET"
    echo ""
    read -p "Press Enter to continue..."
    return 0
  fi

  # Deploy
  deploy_bundle || return 1

  # Wait for database if enabled
  if [[ "$DATABASE_MODE" == "persistent" ]]; then
    local db_instance_name=$(get_database_instance_name)
    wait_for_database "$db_instance_name"
  fi

  echo ""
  print_success "Deployment complete!"
  echo ""
  read -p "Press Enter to continue..."
}

# ============================================
# Main Menu
# ============================================

main_menu() {
  # Load saved state if exists
  load_state 2>/dev/null || true

  while true; do
    local choice
    choice=$(show_menu "Databricks E2E Chatbot Setup Wizard" \
      "🚀 Complete First-Time Setup" \
      "📋 Check Prerequisites" \
      "🔐 Configure Authentication" \
      "⚙️  Configure Deployment" \
      "💾 Enable Database" \
      "🏃 Run Application" \
      "🔍 Diagnostics & Troubleshooting" \
      "ℹ️  Help & Documentation" \
      "❌ Exit")

    case $choice in
      0)
        complete_first_time_setup
        ;;
      1)
        check_all_prerequisites
        echo ""
        read -p "Press Enter to continue..."
        ;;
      2)
        setup_databricks_auth
        echo ""
        read -p "Press Enter to continue..."
        ;;
      3)
        configure_deployment_workflow
        ;;
      4)
        enable_database_workflow
        ;;
      5)
        run_application
        ;;
      6)
        diagnostics_menu
        ;;
      7)
        show_help
        ;;
      8|quit)
        echo ""
        print_info "Thank you for using the setup wizard!"
        exit 0
        ;;
    esac
  done
}

# ============================================
# Entry Point
# ============================================

# Check if running in an interactive terminal
if [[ ! -t 0 ]]; then
  echo "Error: This script requires an interactive terminal."
  echo "Please run it directly from your terminal, not through pipes or redirects."
  exit 1
fi

# Change to project root
cd "$PROJECT_ROOT"

# Show welcome message
clear
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${BOLD}                                                            ${NC}${BLUE}║${NC}"
echo -e "${BLUE}║${BOLD}     Databricks E2E Chatbot - Interactive Setup Wizard     ${NC}${BLUE}║${NC}"
echo -e "${BLUE}║${BOLD}                                                            ${NC}${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "This wizard will help you set up your chatbot application."
echo "Use arrow keys or numbers to navigate menus and Enter to select."
echo ""
echo "Press Enter to begin..."
read -r _dummy

# Start main menu
main_menu
