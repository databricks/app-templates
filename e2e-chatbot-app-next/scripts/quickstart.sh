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

echo "==================================================================="
echo "Databricks Chatbot App - Quickstart Setup"
echo "==================================================================="
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

# Copy .env.example to .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo "Copying .env.example to .env.local..."
    cp .env.example .env.local
    echo
else
    echo ".env.local already exists, skipping copy..."
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
    else
        echo "Databricks authentication failed."
        exit 1
    fi
fi

# Save profile to .env.local
if grep -q "DATABRICKS_CONFIG_PROFILE=" .env.local; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/DATABRICKS_CONFIG_PROFILE=.*/DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME/" .env.local
    else
        sed -i "s/DATABRICKS_CONFIG_PROFILE=.*/DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME/" .env.local
    fi
else
    echo "DATABRICKS_CONFIG_PROFILE=$PROFILE_NAME" >> .env.local
fi
echo "✓ Databricks profile '$PROFILE_NAME' saved to .env.local"
echo

# ===================================================================
# Section 3.5: Validation
# ===================================================================
echo "Validating environment..."

# Calculate derived App Name to ensure it meets length constraints (max 30 chars)
# Logic mirrors how databricks.yml constructs the name: db-chatbot-dev-${workspace.current_user.domain_friendly_name}
USERNAME=$(databricks auth describe --output json 2>/dev/null | jq -r '.username')
if [ -z "$USERNAME" ] || [ "$USERNAME" == "null" ]; then
    echo "Warning: Could not retrieve username from Databricks CLI. Skipping name validation."
else
    # Approximate domain_friendly_name: local part of email, dots/symbols to dashes
    DOMAIN_FRIENDLY=$(echo "$USERNAME" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
    APP_NAME="db-chatbot-dev-$DOMAIN_FRIENDLY"
    APP_NAME_LEN=${#APP_NAME}
    MAX_LEN=30

    if [ $APP_NAME_LEN -gt $MAX_LEN ]; then
        echo "❌ Error: Generated App Name is too long."
        echo "   Calculated Name: '$APP_NAME' ($APP_NAME_LEN chars)"
        echo "   Maximum Length:  $MAX_LEN chars"
        echo
        echo "   Databricks Apps requires names to be 30 characters or less."
        echo "   Please modify 'databricks.yml' to use a shorter name."
        echo "   (Look for 'name: db-chatbot-\${var.resource_name_suffix}' in resources/apps)"
        exit 1
    else
        echo "✓ App name '$APP_NAME' is valid ($APP_NAME_LEN/$MAX_LEN chars)"
    fi
fi
echo

# ===================================================================
# Section 4: Application Configuration
# ===================================================================
echo "Setting up Application Configuration..."

# 1. Serving Endpoint
echo "Enter the name of your Databricks Serving Endpoint (Agent Bricks or custom agent)"
echo "Example: databricks-gpt-5-1"
read -r SERVING_ENDPOINT

if [ -z "$SERVING_ENDPOINT" ]; then
    echo "Error: Serving Endpoint name is required"
    exit 1
fi

# Soft-check if endpoint exists
echo "Checking if endpoint '$SERVING_ENDPOINT' exists..."
set +e
ENDPOINT_CHECK=$(databricks serving-endpoints get "$SERVING_ENDPOINT" 2>/dev/null)
ENDPOINT_EXISTS=$?
set -e

if [ $ENDPOINT_EXISTS -ne 0 ]; then
    echo
    echo "⚠️  Warning: Endpoint '$SERVING_ENDPOINT' could not be found in your workspace."
    echo
    
    echo "Attempting to list available endpoints..."
    set +e
    # List endpoints, parse JSON to get names, limit to top 5
    AVAILABLE_ENDPOINTS=$(databricks serving-endpoints list --output json 2>/dev/null | jq -r '.[].name' | head -n 5)
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
    echo "Do you want to proceed with '$SERVING_ENDPOINT' anyway?"
    read -p "(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please re-run the script with the correct endpoint name."
        exit 1
    fi
    echo "Proceeding with '$SERVING_ENDPOINT'..."
else
    echo "✓ Endpoint found and validated"
fi

# Update databricks.yml with serving endpoint
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/# default: "your-serving-endpoint-name-goes-here"/default: "'"$SERVING_ENDPOINT"'"/' databricks.yml
else
    sed -i 's/# default: "your-serving-endpoint-name-goes-here"/default: "'"$SERVING_ENDPOINT"'"/' databricks.yml
fi

# Update .env.local with serving endpoint
if grep -q "DATABRICKS_SERVING_ENDPOINT=" .env.local; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|DATABRICKS_SERVING_ENDPOINT=.*|DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT|" .env.local
    else
        sed -i "s|DATABRICKS_SERVING_ENDPOINT=.*|DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT|" .env.local
    fi
else
    echo "DATABRICKS_SERVING_ENDPOINT=$SERVING_ENDPOINT" >> .env.local
fi
echo "✓ Serving endpoint configured"

# 2. Database Setup
echo
echo "Do you want to enable persistent chat history (Postgres/Lakebase)?"
echo "This will deploy a database instance to your workspace (~5-10 mins first time)."
read -p "(y/N): " -n 1 -r
echo
USE_DATABASE=false
if [[ $REPLY =~ ^[Yy]$ ]]; then
    USE_DATABASE=true
    echo "Enabling persistent chat history..."
    
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

echo
echo "Installing dependencies..."
npm install
echo "✓ Dependencies installed"

# ===================================================================
# Section 5: Deployment
# ===================================================================
echo
echo "Do you want to deploy the app to Databricks now?"
read -p "(Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo "Deploying bundle (target: dev)..."
    
    if [ "$USE_DATABASE" = true ]; then
        echo "Note: Deployment with database may take 5-10 minutes..."
    fi
    
    databricks bundle deploy -t dev
    DID_DEPLOY=true
else
    echo "Skipping deployment."
    DID_DEPLOY=false
fi

if [ "$USE_DATABASE" = true ]; then
    echo "Configuring database connection..."
    
    # Calculate instance name (logic mirrored from setup.sh)
    USERNAME=$(databricks auth describe --output json 2>/dev/null | jq -r '.username')
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
        PGHOST=$(databricks database get-database-instance "$DB_INSTANCE_NAME" 2>/dev/null | jq -r '.read_write_dns' || echo "")
        
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
        
        # Update .env.local with DB config
        if grep -q "PGHOST=" .env.local; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|PGHOST=.*|PGHOST=$PGHOST|" .env.local
                sed -i '' "s|PGUSER=.*|PGUSER=$USERNAME|" .env.local
            else
                sed -i "s|PGHOST=.*|PGHOST=$PGHOST|" .env.local
                sed -i "s|PGUSER=.*|PGUSER=$USERNAME|" .env.local
            fi
        else
            cat >> .env.local << EOF

# Database Configuration
PGUSER=$USERNAME
PGHOST=$PGHOST
PGDATABASE=databricks_postgres
PGPORT=5432
EOF
        fi
        
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

echo
echo "==================================================================="
echo "Setup Complete!"
echo "==================================================================="
echo "To start the local development server:"
echo "  npm run dev"
echo
echo "To deploy to Databricks:"
echo "  databricks bundle deploy"
echo "  databricks bundle run databricks_chatbot"
echo "==================================================================="

