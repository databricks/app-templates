#!/bin/bash

set -e

# Helper function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Helper function to check if Homebrew is available
has_brew() {
    command_exists brew
}

# Helper function to extract bundle name from databricks.yml
get_current_bundle_name() {
    if [ -f "databricks.yml" ]; then
        awk '/^  apps:$/ {getline; if ($0 ~ /^    [a-zA-Z0-9_-]+:$/) {sub(/:$/, "", $1); print $1}}' databricks.yml
    fi
}

# Helper function to extract app name from databricks.yml
get_current_app_name() {
    if [ -f "databricks.yml" ]; then
        # Look for the name field under apps section (6 spaces indent)
        awk '/^  apps:$/ {found=1} found && /^      name:/ {gsub(/^      name: /, ""); gsub(/\$\{var\.resource_name_suffix\}/, ""); gsub(/db-chatbot-/, ""); print; exit}' databricks.yml
    fi
}

# Helper function to check if database is enabled in databricks.yml
is_database_enabled() {
    if [ -f "databricks.yml" ]; then
        # Check if database_instances.chatbot_lakebase is uncommented (line starts with spaces, not # )
        if grep -q "^    chatbot_lakebase:" databricks.yml; then
            return 0  # Database is enabled
        fi
    fi
    return 1  # Database is not enabled
}

# Helper function to prompt for y/n with validation
# Usage: prompt_yes_no "Question text?" "Y" (for default Yes) or "N" (for default No)
# Returns: 0 for Yes, 1 for No
prompt_yes_no() {
    local question="$1"
    local default="$2"
    local prompt_text

    if [ "$default" = "Y" ]; then
        prompt_text="(Y/n): "
    else
        prompt_text="(y/N): "
    fi

    while true; do
        read -p "$question $prompt_text" -n 1 -r
        echo

        # Empty input - use default
        if [ -z "$REPLY" ]; then
            if [ "$default" = "Y" ]; then
                return 0  # Yes
            else
                return 1  # No
            fi
        fi

        # Check for valid Y/y/N/n
        if [[ "$REPLY" =~ ^[Yy]$ ]]; then
            return 0  # Yes
        elif [[ "$REPLY" =~ ^[Nn]$ ]]; then
            return 1  # No
        else
            echo "Invalid input. Please enter Y, y, N, or n (or press Enter for default)."
        fi
    done
}

echo "==================================================================="
echo "Databricks Chatbot App - Quickstart Setup"
echo "==================================================================="
echo

# ===================================================================
# Section 0: Directory Verification
# ===================================================================
echo "Verifying directory..."

if [ ! -f "databricks.yml" ] || [ ! -f "package.json" ] || [ ! -d "client" ] || [ ! -d "server" ]; then
    echo "❌ Error: This script must be run from the e2e-chatbot-app-next/ directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected files: databricks.yml, package.json"
    echo "   Expected directories: client/, server/"
    exit 1
fi

echo "✓ Running from correct directory"
echo

# ===================================================================
# Section 1: Prerequisites Installation
# ===================================================================
echo "Checking and installing prerequisites..."
echo

# Check and install jq (required for parsing JSON)
if command_exists jq; then
    echo "✓ jq is already installed"
else
    echo "Installing jq..."
    if has_brew; then
        brew install jq
    else
        echo "Please install jq manually (e.g., 'sudo apt-get install jq' or 'sudo yum install jq')"
        exit 1
    fi
    echo "✓ jq installed successfully"
fi

# Check and install nvm
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    echo "✓ nvm is already installed"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
     echo "✓ nvm is already installed (homebrew)"
     export NVM_DIR="/usr/local/opt/nvm"
     [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
     echo "✓ nvm is already installed (homebrew)"
     export NVM_DIR="/opt/homebrew/opt/nvm"
     [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    echo "Installing nvm..."
    if has_brew; then
        echo "Using Homebrew to install nvm..."
        brew install nvm
        mkdir -p ~/.nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"
        [ -s "/usr/local/opt/nvm/nvm.sh" ] && \. "/usr/local/opt/nvm/nvm.sh"
    else
        echo "Using curl to install nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    echo "✓ nvm installed successfully"
fi

# Use Node 20
echo "Setting up Node.js 20..."
nvm install 20
nvm use 20
echo "✓ Node.js 20 is now active"
node --version
npm --version
echo

# Check and install Databricks CLI
if command_exists databricks; then
    echo "✓ Databricks CLI is already installed"
    databricks --version
else
    echo "Installing Databricks CLI..."
    if has_brew; then
        echo "Using Homebrew to install Databricks CLI..."
        brew tap databricks/tap
        brew install databricks
    else
        echo "Using curl to install Databricks CLI..."
        if curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh; then
            echo "✓ Databricks CLI installed successfully"
        else
            echo "Installation failed, trying with sudo..."
            curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sudo sh
        fi
    fi
    echo "✓ Databricks CLI installed successfully"
fi

echo

# ===================================================================
# Section 2: Configuration Files Setup
# ===================================================================
echo "Setting up configuration files..."

# Copy .env.example to .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Copying .env.example to .env..."
    cp .env.example .env
    echo
else
    echo ".env already exists, skipping copy..."
fi
echo

# ===================================================================
# Section 3: Databricks Authentication
# ===================================================================
echo "Setting up Databricks authentication..."

# Check if there are existing profiles
set +e
EXISTING_PROFILES=$(databricks auth profiles 2>/dev/null)
PROFILES_EXIT_CODE=$?
set -e

if [ $PROFILES_EXIT_CODE -eq 0 ] && [ -n "$EXISTING_PROFILES" ]; then
    # Profiles exist - let user select one
    echo "Found existing Databricks profiles:"
    echo

    PROFILE_ARRAY=()
    PROFILE_NAMES=()
    LINE_NUM=0

    while IFS= read -r line; do
        if [ -n "$line" ]; then
            if [ $LINE_NUM -eq 0 ]; then
                echo "$line"
            else
                PROFILE_ARRAY+=("$line")
                PROFILE_NAME_ONLY=$(echo "$line" | awk '{print $1}')
                PROFILE_NAMES+=("$PROFILE_NAME_ONLY")
            fi
            LINE_NUM=$((LINE_NUM + 1))
        fi
    done <<< "$EXISTING_PROFILES"

    echo
    # Display numbered list
    for i in "${!PROFILE_ARRAY[@]}"; do
        echo "$((i+1))) ${PROFILE_ARRAY[$i]}"
    done
    echo

    echo "Enter the number of the profile you want to use:"
    read -r PROFILE_CHOICE
    
    if [ -z "$PROFILE_CHOICE" ]; then
        echo "Error: Profile selection is required"
        exit 1
    fi

    if ! [[ "$PROFILE_CHOICE" =~ ^[0-9]+$ ]]; then
        echo "Error: Please enter a valid number"
        exit 1
    fi

    PROFILE_INDEX=$((PROFILE_CHOICE - 1))

    if [ $PROFILE_INDEX -lt 0 ] || [ $PROFILE_INDEX -ge ${#PROFILE_NAMES[@]} ]; then
        echo "Error: Invalid selection. Please choose a number between 1 and ${#PROFILE_NAMES[@]}"
        exit 1
    fi

    PROFILE_NAME="${PROFILE_NAMES[$PROFILE_INDEX]}"
    echo "Selected profile: $PROFILE_NAME"

    # Test profile
    set +e
    DATABRICKS_CONFIG_PROFILE="$PROFILE_NAME" databricks current-user me >/dev/null 2>&1
    PROFILE_TEST=$?
    set -e

    if [ $PROFILE_TEST -eq 0 ]; then
        echo "✓ Successfully validated profile '$PROFILE_NAME'"
    else
        echo "Profile '$PROFILE_NAME' is not authenticated."
        echo "Authenticating profile '$PROFILE_NAME'..."
        
        set +e
        databricks auth login --profile "$PROFILE_NAME"
        AUTH_EXIT_CODE=$?
        set -e
        
        if [ $AUTH_EXIT_CODE -eq 0 ]; then
            echo "✓ Successfully authenticated profile '$PROFILE_NAME'"
        else
            echo "Error: Profile '$PROFILE_NAME' authentication failed"
            exit 1
        fi
    fi

    # Make this profile the active one for the rest of the script
    export DATABRICKS_CONFIG_PROFILE="$PROFILE_NAME"
    echo "Using Databricks profile: $DATABRICKS_CONFIG_PROFILE"
else
    # No profiles exist - create default one
    echo "No existing profiles found. Setting up Databricks authentication..."
    echo "Please enter your Databricks host URL (e.g., https://your-workspace.cloud.databricks.com):"
    read -r DATABRICKS_HOST

    if [ -z "$DATABRICKS_HOST" ]; then
        echo "Error: Databricks host is required"
        exit 1
    fi

    echo "Authenticating with Databricks..."
    set +e
    databricks auth login --host "$DATABRICKS_HOST"
    AUTH_EXIT_CODE=$?
    set -e

    if [ $AUTH_EXIT_CODE -eq 0 ]; then
        echo "✓ Successfully authenticated with Databricks"
        # Try to find what profile was created, assume DEFAULT if unknown
        PROFILE_NAME="DEFAULT"
        echo "Using profile 'DEFAULT'"

        # Make this profile the active one for the rest of the script
        # export DATABRICKS_CONFIG_PROFILE="$PROFILE_NAME"
        echo "Using Databricks profile: $PROFILE_NAME"
    else
        echo "Databricks authentication failed."
        exit 1
    fi
fi

# Save profile to .env
if grep -q "DATABRICKS_CONFIG_PROFILE=" .env; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/DATABRICKS_CONFIG_PROFILE=.*/DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME/" .env
    else
        sed -i "s/DATABRICKS_CONFIG_PROFILE=.*/DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME/" .env
    fi
else
    echo "DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME" >> .env
fi
echo "✓ Databricks profile '$PROFILE_NAME' saved to .env"
echo

# Validation will happen after name customization section
echo

# ===================================================================
# Section 4: Application Configuration
# ===================================================================
echo "Setting up Application Configuration..."

# 1. Serving Endpoint
DEFAULT_ENDPOINT="databricks-claude-sonnet-4"
echo "Enter the name of your Databricks Serving Endpoint (Agent Bricks or custom agent)"
echo "Press Enter to use default: $DEFAULT_ENDPOINT"
read -r SERVING_ENDPOINT

if [ -z "$SERVING_ENDPOINT" ]; then
    SERVING_ENDPOINT="$DEFAULT_ENDPOINT"
    echo "Using default endpoint: $SERVING_ENDPOINT"
fi

# Soft-check if endpoint exists
echo "Checking if endpoint '$SERVING_ENDPOINT' exists..."
set +e
ENDPOINT_CHECK=$(databricks serving-endpoints get "$SERVING_ENDPOINT" --profile "$PROFILE_NAME" 2>/dev/null)
ENDPOINT_EXISTS=$?
set -e

if [ $ENDPOINT_EXISTS -ne 0 ]; then
    echo
    echo "⚠️  Warning: Endpoint '$SERVING_ENDPOINT' could not be found in your workspace."
    echo
    
    echo "Attempting to list available endpoints..."
    set +e
    # List endpoints, parse JSON to get names, limit to top 5
    AVAILABLE_ENDPOINTS=$(databricks serving-endpoints list --profile "$PROFILE_NAME" --output json 2>/dev/null | jq -r '.[].name' | head -n 5)
    LIST_EXIT_CODE=$?
    set -e

    if [ $LIST_EXIT_CODE -eq 0 ] && [ -n "$AVAILABLE_ENDPOINTS" ]; then
        echo "Here are some available endpoints found in your workspace:"
        echo "------------------------------------------------"
        echo "$AVAILABLE_ENDPOINTS"
        echo "------------------------------------------------"
        echo "(showing first 5)"
    else
        echo "Could not list available endpoints (or none found)."
    fi
    
    echo
    if prompt_yes_no "Do you want to proceed with '$SERVING_ENDPOINT' anyway?" "N"; then
        echo "Proceeding with '$SERVING_ENDPOINT'..."
    else
        echo "Please re-run the script with the correct endpoint name."
        exit 1
    fi
else
    echo "✓ Endpoint found and validated"
fi

# Update databricks.yml with serving endpoint
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/# default: "your-serving-endpoint-name-goes-here"/default: "'"$SERVING_ENDPOINT"'"/' databricks.yml
else
    sed -i 's/# default: "your-serving-endpoint-name-goes-here"/default: "'"$SERVING_ENDPOINT"'"/' databricks.yml
fi

# Update .env with serving endpoint
if grep -q "DATABRICKS_SERVING_ENDPOINT=" .env; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|DATABRICKS_SERVING_ENDPOINT=.*|DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT|" .env
    else
        sed -i "s|DATABRICKS_SERVING_ENDPOINT=.*|DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT|" .env
    fi
else
    echo "DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT" >> .env
fi
echo "✓ Serving endpoint configured"

# 2. App and Bundle Name Configuration (within Section 4)
echo
echo "App and Bundle Name Configuration"
echo "-----------------------------------"

# Calculate default app name
USERNAME=$(databricks auth describe --profile "$PROFILE_NAME" --output json 2>/dev/null | jq -r '.username')
if [ -z "$USERNAME" ] || [ "$USERNAME" == "null" ]; then
    DOMAIN_FRIENDLY="user"
    echo "Warning: Could not retrieve username, using 'user' as suffix"
else
    # Approximate domain_friendly_name: local part of email, dots/symbols to dashes
    DOMAIN_FRIENDLY=$(echo "$USERNAME" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
fi

DEFAULT_APP_NAME="db-chatbot-dev-$DOMAIN_FRIENDLY"
DEFAULT_APP_NAME_LEN=${#DEFAULT_APP_NAME}
MAX_LEN=30

# Auto-truncate if default name is too long
if [ $DEFAULT_APP_NAME_LEN -gt $MAX_LEN ]; then
    DEFAULT_APP_NAME="${DEFAULT_APP_NAME:0:$MAX_LEN}"
    echo "⚠️  Default app name was truncated to $MAX_LEN characters: '$DEFAULT_APP_NAME'"
fi

# Detect existing configuration
EXISTING_BUNDLE_NAME=$(get_current_bundle_name)
EXISTING_APP_NAME_RAW=$(get_current_app_name)

# Check if custom names are already configured
if [ -n "$EXISTING_BUNDLE_NAME" ] && [ "$EXISTING_BUNDLE_NAME" != "databricks_chatbot" ]; then
    # Custom configuration detected
    echo "✓ Detected existing custom configuration:"
    echo "  Bundle name: $EXISTING_BUNDLE_NAME"
    echo "  App name pattern: db-chatbot-\${var.resource_name_suffix}"
    echo
    echo "Note: App/bundle names cannot be changed after first deployment."
    echo "Continuing with existing configuration..."
    BUNDLE_NAME="$EXISTING_BUNDLE_NAME"
    FINAL_APP_NAME="$DEFAULT_APP_NAME"  # Will use default since we can't easily extract the resolved name
elif [ -n "$EXISTING_BUNDLE_NAME" ]; then
    # Default configuration detected
    echo "Detected default configuration (bundle name: databricks_chatbot)"
    echo "Default app name: $DEFAULT_APP_NAME (${#DEFAULT_APP_NAME} chars)"
    echo

    BUNDLE_NAME="databricks_chatbot"  # Default
    FINAL_APP_NAME="$DEFAULT_APP_NAME"  # Will be updated if customized

    if prompt_yes_no "Do you want to customize these names?" "N"; then
    # App name validation loop
    while true; do
        echo "Enter custom app name (max $MAX_LEN chars, press Enter to keep default):"
        echo "Current default: $DEFAULT_APP_NAME"
        read -r CUSTOM_APP_NAME

        if [ -z "$CUSTOM_APP_NAME" ]; then
            # User pressed Enter, keep default
            break
        fi

        # Validate length
        CUSTOM_APP_NAME_LEN=${#CUSTOM_APP_NAME}
        if [ $CUSTOM_APP_NAME_LEN -gt $MAX_LEN ]; then
            echo "❌ Error: App name must be $MAX_LEN characters or less (current: $CUSTOM_APP_NAME_LEN chars)"
            echo "Please try again."
            echo
        else
            FINAL_APP_NAME="$CUSTOM_APP_NAME"
            echo "✓ App name is valid ($CUSTOM_APP_NAME_LEN/$MAX_LEN chars)"
            break
        fi
    done

    # Bundle name validation loop
    if [ "$FINAL_APP_NAME" != "$DEFAULT_APP_NAME" ]; then
        while true; do
            echo
            echo "Enter bundle name for 'databricks bundle run <name>' (max $MAX_LEN chars):"
            echo "Press Enter to use the same as app name: $FINAL_APP_NAME"
            read -r BUNDLE_NAME_INPUT

            if [ -z "$BUNDLE_NAME_INPUT" ]; then
                # Use app name as bundle name
                BUNDLE_NAME="$FINAL_APP_NAME"
                break
            fi

            # Validate length
            BUNDLE_NAME_LEN=${#BUNDLE_NAME_INPUT}
            if [ $BUNDLE_NAME_LEN -gt $MAX_LEN ]; then
                echo "❌ Error: Bundle name must be $MAX_LEN characters or less (current: $BUNDLE_NAME_LEN chars)"
                echo "Please try again."
            else
                BUNDLE_NAME="$BUNDLE_NAME_INPUT"
                echo "✓ Bundle name is valid ($BUNDLE_NAME_LEN/$MAX_LEN chars)"
                break
            fi
        done

        # Update databricks.yml
        echo "Updating databricks.yml with custom names..."

        # 1. Update the top-level bundle name (this is what determines the workspace path!)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' 's|^  name: .*|  name: '"$BUNDLE_NAME"'|' databricks.yml
        else
            sed -i 's|^  name: .*|  name: '"$BUNDLE_NAME"'|' databricks.yml
        fi

        # 2. Get the current bundle key under apps: to replace it accurately
        CURRENT_BUNDLE_KEY=$(awk '/^  apps:$/ {getline; if ($0 ~ /^    [a-zA-Z0-9_-]+:$/) {sub(/:$/, "", $1); print $1}}' databricks.yml)

        if [ -n "$CURRENT_BUNDLE_KEY" ]; then
            # 3. Change the app resource key (should match bundle name for consistency)
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/^    ${CURRENT_BUNDLE_KEY}:$/    ${BUNDLE_NAME}:/" databricks.yml
            else
                sed -i "s/^    ${CURRENT_BUNDLE_KEY}:$/    ${BUNDLE_NAME}:/" databricks.yml
            fi

            # 4. Change the app name field
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # Replace any name: line that appears in the apps section (6 spaces indent)
                sed -i '' 's|^      name: .*|      name: '"$FINAL_APP_NAME"'|' databricks.yml
            else
                sed -i 's|^      name: .*|      name: '"$FINAL_APP_NAME"'|' databricks.yml
            fi
        else
            echo "Warning: Could not find apps section in databricks.yml"
            echo "Please manually update the bundle and app names in databricks.yml"
        fi

        echo "✓ App name set to: $FINAL_APP_NAME"
        echo "✓ Bundle name set to: $BUNDLE_NAME"
    else
        echo "Keeping default names"
    fi
    else
        echo "Using default names"
        # Still need to ensure the default name is valid
        if [ "$DEFAULT_APP_NAME" != "db-chatbot-dev-$DOMAIN_FRIENDLY" ]; then
            echo "Note: Default app name was truncated to meet $MAX_LEN character limit"
        fi
    fi
else
    # If no existing bundle name found (shouldn't happen, but handle gracefully)
    echo "Warning: Could not detect existing bundle configuration"
    echo "Using default names"
    BUNDLE_NAME="databricks_chatbot"
    FINAL_APP_NAME="$DEFAULT_APP_NAME"
fi

# 3. Database Setup (within Section 4)
echo
echo "Database Configuration"
echo "----------------------"

# Calculate the database instance name that will be used
USERNAME=$(databricks auth describe --profile "$PROFILE_NAME" --output json 2>/dev/null | jq -r '.username')
DOMAIN_FRIENDLY=$(echo "$USERNAME" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
CALCULATED_DB_INSTANCE_NAME="chatbot-lakebase-dev-$DOMAIN_FRIENDLY"

# Check if database is already enabled
if is_database_enabled; then
    echo "✓ Detected existing database configuration (persistent chat history enabled)"
    echo

    # Check if a database instance with this name already exists in the workspace
    echo "Checking for existing database instance in workspace..."
    set +e
    EXISTING_DB_CHECK=$(databricks database get-database-instance "$CALCULATED_DB_INSTANCE_NAME" --profile "$PROFILE_NAME" 2>/dev/null)
    EXISTING_DB_EXIT_CODE=$?
    set -e

    if [ $EXISTING_DB_EXIT_CODE -eq 0 ]; then
        echo
        echo "⚠️  CONFLICT DETECTED"
        echo "-------------------------------------------------------------------"
        echo "Found existing database instance: $CALCULATED_DB_INSTANCE_NAME"
        echo
        echo "This database instance already exists in your workspace, likely from"
        echo "a previous deployment. Terraform cannot create a new instance with"
        echo "the same name."
        echo
        echo "Options:"
        echo "  1. Delete the existing instance and create fresh (loses all data)"
        echo "  2. Skip database setup (deploy without persistent chat history)"
        echo "  3. Exit and manually resolve the conflict"
        echo
        echo "To delete the existing instance, run:"
        echo "  ./scripts/cleanup-database.sh"
        echo "  (or manually: databricks database delete-database-instance $CALCULATED_DB_INSTANCE_NAME --profile \"$PROFILE_NAME\")"
        echo "-------------------------------------------------------------------"
        echo

        if prompt_yes_no "Do you want to skip database setup and deploy without persistent chat history?" "Y"; then
            echo "Disabling database in databricks.yml..."
            USE_DATABASE=false

            # Comment out database sections
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' '/^ *chatbot_lakebase:/s/^    /    # /' databricks.yml
                sed -i '' '/^ *name: \${var.database_instance_name}/s/^    /    # /' databricks.yml
                sed -i '' '/^ *capacity: CU_1/s/^    /    # /' databricks.yml
                sed -i '' '/^ *- name: database/s/^        /        # /' databricks.yml
                sed -i '' '/^ *description: "Lakebase database instance/s/^        /        # /' databricks.yml
                sed -i '' '/^ *database:/s/^        /        # /' databricks.yml
                sed -i '' '/^ *database_name: databricks_postgres/s/^        /        # /' databricks.yml
                sed -i '' '/^ *instance_name: \${resources/s/^        /        # /' databricks.yml
                sed -i '' '/^ *permission: CAN_CONNECT/s/^        /        # /' databricks.yml
            else
                sed -i '/^ *chatbot_lakebase:/s/^    /    # /' databricks.yml
                sed -i '/^ *name: \${var.database_instance_name}/s/^    /    # /' databricks.yml
                sed -i '/^ *capacity: CU_1/s/^    /    # /' databricks.yml
                sed -i '/^ *- name: database/s/^        /        # /' databricks.yml
                sed -i '/^ *description: "Lakebase database instance/s/^        /        # /' databricks.yml
                sed -i '/^ *database:/s/^        /        # /' databricks.yml
                sed -i '/^ *database_name: databricks_postgres/s/^        /        # /' databricks.yml
                sed -i '/^ *instance_name: \${resources/s/^        /        # /' databricks.yml
                sed -i '/^ *permission: CAN_CONNECT/s/^        /        # /' databricks.yml
            fi
            echo "✓ Database sections commented out in databricks.yml"
        else
            echo
            echo "Please resolve the conflict and re-run this script."
            echo "Options:"
            echo "  1. Run: ./scripts/cleanup-database.sh"
            echo "  2. Or manually delete: databricks database delete-database-instance $CALCULATED_DB_INSTANCE_NAME --profile \"$PROFILE_NAME\""
            exit 1
        fi
    else
        echo
        echo "⚠️  Database is configured in databricks.yml, but no database instance exists yet."
        echo "   Expected instance name: $CALCULATED_DB_INSTANCE_NAME"
        echo
        echo "This is normal for a first-time deployment."
        echo
        USE_DATABASE=true
    fi
else
    echo "Persistent chat history requires a Postgres/Lakebase database instance."
    echo "This will deploy a database instance to your workspace (~5-10 mins first time)."
    echo
    echo "Checking for existing database instances..."

    # Check if a database instance with the calculated name already exists
    set +e
    EXISTING_DB_CHECK=$(databricks database get-database-instance "$CALCULATED_DB_INSTANCE_NAME" --profile "$PROFILE_NAME" 2>/dev/null)
    EXISTING_DB_EXIT_CODE=$?
    set -e

    if [ $EXISTING_DB_EXIT_CODE -eq 0 ]; then
        echo
        echo "⚠️  Found existing database instance: $CALCULATED_DB_INSTANCE_NAME"
        echo
        echo "This database instance name is already in use (likely from a previous deployment)."
        echo
        echo "Options:"
        echo "  1. Skip database setup (use ephemeral mode - no persistent chat history)"
        echo "  2. Continue anyway (may cause deployment errors if bundle config conflicts)"
        echo "  3. Exit and manually delete the old database instance first"
        echo
        echo "To manually delete the database instance, run:"
        echo "  databricks database delete-database-instance $CALCULATED_DB_INSTANCE_NAME --profile \"$PROFILE_NAME\""
        echo
        if prompt_yes_no "Do you want to skip database setup and use ephemeral mode?" "Y"; then
            USE_DATABASE=false
            echo "Skipping database setup. App will use ephemeral mode (no persistent chat history)."
        else
            USE_DATABASE=true
            echo "⚠️  Continuing with database setup. If deployment fails, you'll need to manually delete"
            echo "   the existing database instance and try again."
        fi
    else
        USE_DATABASE=false
        if prompt_yes_no "Do you want to enable persistent chat history?" "N"; then
            USE_DATABASE=true
            echo "Enabling persistent chat history..."
        fi
    fi

    if [ "$USE_DATABASE" = true ]; then
    
    # Uncomment database sections in databricks.yml
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Section 1: Uncomment database_instances.chatbot_lakebase
        sed -i '' '/# chatbot_lakebase:/s/^    # /    /' databricks.yml
        sed -i '' '/#   name: \${var.database_instance_name}/s/^    # /    /' databricks.yml
        sed -i '' '/#   capacity: CU_1/s/^    # /    /' databricks.yml
        
        # Section 2: Uncomment database resource binding
        sed -i '' '/# - name: database/s/^        # /        /' databricks.yml
        sed -i '' '/#   description: "Lakebase database instance/s/^        # /        /' databricks.yml
        sed -i '' '/#   database:/s/^        # /        /' databricks.yml
        sed -i '' '/#     database_name: databricks_postgres/s/^        # /        /' databricks.yml
        sed -i '' '/#     instance_name: \${resources/s/^        # /        /' databricks.yml
        sed -i '' '/#     permission: CAN_CONNECT/s/^        # /        /' databricks.yml
    else
        # Linux sed syntax
        sed -i '/# chatbot_lakebase:/s/^    # /    /' databricks.yml
        sed -i '/#   name: \${var.database_instance_name}/s/^    # /    /' databricks.yml
        sed -i '/#   capacity: CU_1/s/^    # /    /' databricks.yml
        
        sed -i '/# - name: database/s/^        # /        /' databricks.yml
        sed -i '/#   description: "Lakebase database instance/s/^        # /        /' databricks.yml
        sed -i '/#   database:/s/^        # /        /' databricks.yml
        sed -i '/#     database_name: databricks_postgres/s/^        # /        /' databricks.yml
        sed -i '/#     instance_name: \${resources/s/^        # /        /' databricks.yml
        sed -i '/#     permission: CAN_CONNECT/s/^        # /        /' databricks.yml
    fi
    echo "✓ Database configuration enabled in databricks.yml"
else
    echo "Using ephemeral mode (no database)."
    echo "Disabling persistent chat history in databricks.yml..."

    # Comment out database sections in databricks.yml if they were previously uncommented
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Section 1: Comment out database_instances.chatbot_lakebase
        sed -i '' '/^ *chatbot_lakebase:/s/^    /    # /' databricks.yml
        sed -i '' '/^ *name: \${var.database_instance_name}/s/^    /    # /' databricks.yml
        sed -i '' '/^ *capacity: CU_1/s/^    /    # /' databricks.yml
        
        # Section 2: Comment out database resource binding
        sed -i '' '/^ *- name: database/s/^        /        # /' databricks.yml
        sed -i '' '/^ *description: "Lakebase database instance/s/^        /        # /' databricks.yml
        sed -i '' '/^ *database:/s/^        /        # /' databricks.yml
        sed -i '' '/^ *database_name: databricks_postgres/s/^        /        # /' databricks.yml
        sed -i '' '/^ *instance_name: \${resources/s/^        /        # /' databricks.yml
        sed -i '' '/^ *permission: CAN_CONNECT/s/^        /        # /' databricks.yml
    else
        # Linux sed syntax
        sed -i '/^ *chatbot_lakebase:/s/^    /    # /' databricks.yml
        sed -i '/^ *name: \${var.database_instance_name}/s/^    /    # /' databricks.yml
        sed -i '/^ *capacity: CU_1/s/^    /    # /' databricks.yml
        
        sed -i '/^ *- name: database/s/^        /        # /' databricks.yml
        sed -i '/^ *description: "Lakebase database instance/s/^        /        # /' databricks.yml
        sed -i '/^ *database:/s/^        /        # /' databricks.yml
        sed -i '/^ *database_name: databricks_postgres/s/^        /        # /' databricks.yml
        sed -i '/^ *instance_name: \${resources/s/^        /        # /' databricks.yml
        sed -i '/^ *permission: CAN_CONNECT/s/^        /        # /' databricks.yml
    fi

    echo "⚠️  Note: If you previously deployed this app with a database, the database instance in Databricks is NOT deleted by this script."
    echo "   To avoid costs, please manually delete the 'chatbot-lakebase' instance in your Databricks workspace if it's no longer needed."
    fi
fi

echo
echo "Installing dependencies..."
npm install
echo "✓ Dependencies installed"

# ===================================================================
# Section 5: Deployment
# ===================================================================
echo
if prompt_yes_no "Do you want to deploy the app to Databricks now?" "Y"; then
    # Clear bundle cache to ensure fresh deployment with new names
    if [ -d ".databricks" ]; then
        echo "Clearing bundle cache to ensure fresh deployment..."
        rm -rf .databricks
    fi

    echo "Deploying bundle (target: dev)..."

    if [ "$USE_DATABASE" = true ]; then
        echo "Note: Deployment with database may take 5-10 minutes..."
    fi

    databricks bundle deploy -t dev --profile "$PROFILE_NAME"
    DID_DEPLOY=true
else
    echo "Skipping deployment."
    DID_DEPLOY=false
fi

if [ "$USE_DATABASE" = true ]; then
    echo "Configuring database connection..."
    
    # Calculate instance name (logic mirrored from setup.sh)
    USERNAME=$(databricks auth describe --profile "$PROFILE_NAME" --output json 2>/dev/null | jq -r '.username')
    DOMAIN_FRIENDLY=$(echo "$USERNAME" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
    DB_INSTANCE_NAME="chatbot-lakebase-dev-$DOMAIN_FRIENDLY"
    
    echo "Instance name: $DB_INSTANCE_NAME"
    
    # Poll for PGHOST
    PGHOST=""
    
    if [ "$DID_DEPLOY" = true ]; then
        MAX_RETRIES=60 # 10 minutes if we deployed
        echo "Waiting for database to be ready..."
        echo "Note: This may take a few minutes while the database is being provisioned."
    else
        MAX_RETRIES=1 # Just check once if we didn't deploy
        echo "Checking for existing database..."
    fi
    
    RETRIES=0
    while [ $RETRIES -lt $MAX_RETRIES ]; do
        PGHOST=$(databricks database get-database-instance "$DB_INSTANCE_NAME" --profile "$PROFILE_NAME" 2>/dev/null | jq -r '.read_write_dns' || echo "")
        
        if [[ -n "$PGHOST" && "$PGHOST" != "null" ]]; then
            break
        fi
        
        if [ "$DID_DEPLOY" = true ]; then
             echo "Waiting for database DNS... (attempt $((RETRIES+1))/$MAX_RETRIES)"
             sleep 10
        fi
        RETRIES=$((RETRIES + 1))
    done
    
    if [[ -n "$PGHOST" && "$PGHOST" != "null" ]]; then
        echo "✓ Database found: $PGHOST"

        # Update .env with DB config
        # Always ensure all database variables are set

        # Remove existing database section if it exists to avoid duplicates
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/^# Database Configuration$/,/^PGPORT=.*$/d' .env 2>/dev/null || true
            sed -i '' '/^PGUSER=.*$/d' .env 2>/dev/null || true
            sed -i '' '/^PGHOST=.*$/d' .env 2>/dev/null || true
            sed -i '' '/^PGDATABASE=.*$/d' .env 2>/dev/null || true
            sed -i '' '/^PGPORT=.*$/d' .env 2>/dev/null || true
        else
            sed -i '/^# Database Configuration$/,/^PGPORT=.*$/d' .env 2>/dev/null || true
            sed -i '/^PGUSER=.*$/d' .env 2>/dev/null || true
            sed -i '/^PGHOST=.*$/d' .env 2>/dev/null || true
            sed -i '/^PGDATABASE=.*$/d' .env 2>/dev/null || true
            sed -i '/^PGPORT=.*$/d' .env 2>/dev/null || true
        fi

        # Add all database variables
        cat >> .env << EOF

# Database Configuration
PGUSER=$USERNAME
PGHOST=$PGHOST
PGDATABASE=databricks_postgres
PGPORT=5432
EOF

        echo "Running database migrations..."
        npm run db:migrate
        echo "✓ Database migrations completed"

    else
        if [ "$DID_DEPLOY" = true ]; then
             echo "Warning: Timed out waiting for database DNS. You may need to check the status manually."
        else
             echo "Warning: Could not find existing database '$DB_INSTANCE_NAME'."
             echo "If you haven't deployed the database yet, please run 'databricks bundle deploy' or enable deployment in this script."
             echo "⚠️  IMPORTANT: Local development with persistent chat history will NOT work until the database is created."
             echo "   You can still run 'npm run dev', but the app may fail to connect to the database."
        fi
    fi
fi

# ===================================================================
# Section 6: Start the App
# ===================================================================
if [ "$DID_DEPLOY" = true ]; then
    echo
    echo "Starting the application..."
    echo "Running: databricks bundle run $BUNDLE_NAME --profile \"$PROFILE_NAME\""
    echo

    set +e
    databricks bundle run "$BUNDLE_NAME" --profile "$PROFILE_NAME"
    RUN_EXIT_CODE=$?
    set -e

    if [ $RUN_EXIT_CODE -eq 0 ]; then
        echo "✓ Application started successfully"
    else
        echo "⚠️  Warning: Failed to start application (exit code: $RUN_EXIT_CODE)"
        echo "   You can try starting it manually with:"
        echo "   databricks bundle run $BUNDLE_NAME --profile \"$PROFILE_NAME\""
    fi
fi

echo
echo "==================================================================="
echo "Setup Complete!"
echo "==================================================================="
echo "To start the local development server:"
echo "  npm run dev"
echo
echo "To deploy to Databricks:"
echo "  databricks bundle deploy --profile \"$PROFILE_NAME\""
echo "  databricks bundle run $BUNDLE_NAME --profile \"$PROFILE_NAME\""
echo "==================================================================="
echo
echo "Troubleshooting:"
echo "-----------------------------------------------------------------"
echo "If deployment failed with 'Instance name is not unique' error:"
echo
echo "1. List existing database instances:"
echo "   databricks database list-database-instances --profile \"$PROFILE_NAME\""
echo
echo "2. Delete the conflicting instance (WARNING: deletes all data):"
echo "   databricks database delete-database-instance $CALCULATED_DB_INSTANCE_NAME --profile \"$PROFILE_NAME\""
echo
echo "3. Re-run this script:"
echo "   ./scripts/quickstart.sh"
echo
echo "Or, to continue without persistent chat history:"
echo "   - Edit databricks.yml and comment out the database sections"
echo "   - Run: databricks bundle deploy --profile \"$PROFILE_NAME\""
echo "==================================================================="

