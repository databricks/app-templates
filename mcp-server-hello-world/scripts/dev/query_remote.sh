#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Test Remote MCP Server - Databricks App"
echo "=========================================="
echo ""

# Step 1: Get Databricks profile name
read -p "Enter Databricks profile name (e.g., DEFAULT, dogfood): " profile_name
if [ -z "$profile_name" ]; then
    echo "❌ Error: Profile name is required"
    exit 1
fi

echo "✓ Using profile: $profile_name"
echo ""

# Step 2: Get Databricks App name
read -p "Enter Databricks App name (e.g., mcp-hello-world): " app_name
if [ -z "$app_name" ]; then
    echo "❌ Error: App name is required"
    exit 1
fi

echo "✓ Using app: $app_name"
echo ""

# Step 3: Get app information
echo "Step 1: Getting app information..."
app_info=$(databricks apps get "$app_name" --profile "$profile_name" 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to get app information"
    echo "$app_info"
    exit 1
fi

# Extract scopes from effective_user_api_scopes (JSON format)
# Try using jq for proper JSON parsing if available
if command -v jq &> /dev/null; then
    scopes=$(echo "$app_info" | jq -r '.effective_user_api_scopes | join(" ")' 2>/dev/null)
    if [ "$scopes" = "null" ] || [ -z "$scopes" ]; then
        scopes=""
    fi
else
    # Fallback: Use sed/grep to extract scopes from JSON
    # Extract lines between "effective_user_api_scopes": [ and ]
    # Then extract quoted strings containing colons (scope format: "service:permission")
    scopes=$(echo "$app_info" | sed -n '/effective_user_api_scopes/,/\]/p' | grep -oE '"[^"]+:[^"]+"' | sed 's/"//g' | tr '\n' ' ' | sed 's/ $//')
fi

if [ -z "$scopes" ]; then
    echo "❌ Error: Could not extract scopes from app info"
    echo "Please ensure the app has user authorization scopes configured"
    exit 1
fi

echo "✓ Extracted scopes: $scopes"

# Extract app URL
app_url=$(echo "$app_info" | grep -E '^\s*"url":' | sed 's/.*"url":"\([^"]*\)".*/\1/')

if [ -z "$app_url" ]; then
    echo "❌ Error: Could not extract app URL from app info"
    exit 1
fi

echo "✓ Extracted app URL: $app_url"
echo ""

# Step 4: Get workspace host
echo "Step 2: Getting workspace host..."
auth_info=$(databricks auth describe --profile "$profile_name" 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to get auth information"
    echo "$auth_info"
    exit 1
fi

# Extract host from auth info
host=$(echo "$auth_info" | grep -E '^\s*Host:' | awk '{print $2}')

if [ -z "$host" ]; then
    echo "❌ Error: Could not extract host from auth info"
    exit 1
fi

echo "✓ Extracted host: $host"
echo ""

# Step 5: Generate OAuth token
echo "Step 3: Generating OAuth token..."
echo "This will open your browser for authorization..."
echo ""

# Run the OAuth token generation and capture JSON output
token_response=$(uv run python "$SCRIPT_DIR/generate_oauth_token.py" \
    --host "$host" \
    --scopes "$scopes")

oauth_exit_code=$?

if [ $oauth_exit_code -ne 0 ]; then
    echo ""
    echo "❌ Error: Failed to generate OAuth token (exit code: $oauth_exit_code)"
    exit 1
fi

# Extract access_token from JSON response
if command -v jq &> /dev/null; then
    token=$(echo "$token_response" | jq -r '.access_token')
else
    # Fallback: Use grep and sed to extract access_token
    token=$(echo "$token_response" | grep -o '"access_token"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$token" ] || [ "$token" = "null" ]; then
    echo ""
    echo "❌ Error: Failed to extract access token from response"
    exit 1
fi

echo ""
echo "✓ OAuth token generated successfully"
echo ""

# Step 6: Run the test
echo "Step 4: Testing remote MCP server..."
echo ""

cd "$PROJECT_ROOT"

uv run python "$SCRIPT_DIR/query_remote.py" \
    --host "$host" \
    --token "$token" \
    --app-url "$app_url"

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✓ Remote MCP Server Test Complete!"
    echo "=========================================="
else
    echo ""
    echo "=========================================="
    echo "✗ Remote MCP Server Test Failed"
    echo "=========================================="
    exit 1
fi

