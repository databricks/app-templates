#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Test MCP Server - Databricks App (Remote)"
echo "=========================================="
echo ""

# Step 1: Choose authentication method
echo "Step 1: Select Databricks authentication method"
echo ""
echo "1) Use Databricks CLI Profile"
echo "2) Use Host and Token"
echo ""
read -p "Enter your choice (1 or 2): " auth_choice

if [ "$auth_choice" == "1" ]; then
    echo ""
    echo "You selected: Databricks CLI Profile"
    echo "Learn more: https://docs.databricks.com/aws/en/dev-tools/cli/profiles#get-information-about-configuration-profiles"
    echo ""
    
    read -p "Enter profile name (or press Enter for DEFAULT): " profile_name
    if [ -z "$profile_name" ]; then
        profile_name="DEFAULT"
    fi
    
    AUTH_TYPE="profile"
    PROFILE_NAME="$profile_name"
    
    echo "✓ Using profile: $PROFILE_NAME"
    
elif [ "$auth_choice" == "2" ]; then
    echo ""
    echo "You selected: Host and Token"
    echo ""
    
    read -p "Enter Databricks workspace host (e.g., https://your-workspace.cloud.databricks.com): " databricks_host
    read -sp "Enter Databricks personal access token: " databricks_token
    echo ""
    
    if [ -z "$databricks_host" ] || [ -z "$databricks_token" ]; then
        echo "❌ Error: Both host and token are required"
        exit 1
    fi
    
    AUTH_TYPE="token"
    DATABRICKS_HOST="$databricks_host"
    DATABRICKS_TOKEN="$databricks_token"
    
    echo "✓ Using host: $DATABRICKS_HOST"
    
else
    echo "❌ Invalid choice. Please run the script again and select 1 or 2."
    exit 1
fi

# Step 2: Get app URL
echo ""
echo "Step 2: Enter your Databricks App MCP endpoint URL"
echo ""
read -p "Enter App URL: " app_url

if [ -z "$app_url" ]; then
    echo "❌ Error: App URL is required"
    exit 1
fi

echo "✓ App URL: $app_url"
echo ""

# Step 3: Run the test
echo "=========================================="
echo "Running MCP Client Test..."
echo "=========================================="
echo ""

cd "$PROJECT_ROOT"

if [ "$AUTH_TYPE" == "profile" ]; then
    python "$SCRIPT_DIR/test_client_remote.py" --profile "$PROFILE_NAME" --app-url "$app_url"
else
    python "$SCRIPT_DIR/test_client_remote.py" --host "$DATABRICKS_HOST" --token "$DATABRICKS_TOKEN" --app-url "$app_url"
fi

echo ""
echo "=========================================="
echo "Test Complete!"
echo "=========================================="

