#!/bin/bash

set -e

echo "==================================================================="
echo "Databricks Chatbot - Database Instance Cleanup"
echo "==================================================================="
echo
echo "This script helps you delete existing database instances that may"
echo "be preventing new deployments."
echo
echo "⚠️  WARNING: Deleting a database instance will:"
echo "  - Permanently delete all data in the database"
echo "  - Cannot be undone"
echo "  - May take a few minutes to complete"
echo
echo "==================================================================="
echo

# Helper function to prompt for y/n with validation
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

        if [ -z "$REPLY" ]; then
            if [ "$default" = "Y" ]; then
                return 0
            else
                return 1
            fi
        fi

        if [[ "$REPLY" =~ ^[Yy]$ ]]; then
            return 0
        elif [[ "$REPLY" =~ ^[Nn]$ ]]; then
            return 1
        else
            echo "Invalid input. Please enter Y, y, N, or n (or press Enter for default)."
        fi
    done
}

# Check for Databricks CLI
if ! command -v databricks >/dev/null 2>&1; then
    echo "❌ Error: Databricks CLI is not installed"
    echo "Please install it first: https://docs.databricks.com/dev-tools/cli/install.html"
    exit 1
fi

# Get profile
echo "Checking for existing Databricks profiles..."
set +e
EXISTING_PROFILES=$(databricks auth profiles 2>/dev/null)
PROFILES_EXIT_CODE=$?
set -e

if [ $PROFILES_EXIT_CODE -eq 0 ] && [ -n "$EXISTING_PROFILES" ]; then
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
    for i in "${!PROFILE_ARRAY[@]}"; do
        echo "$((i+1))) ${PROFILE_ARRAY[$i]}"
    done
    echo

    echo "Enter the number of the profile you want to use:"
    read -r PROFILE_CHOICE

    if [ -z "$PROFILE_CHOICE" ] || ! [[ "$PROFILE_CHOICE" =~ ^[0-9]+$ ]]; then
        echo "Error: Invalid selection"
        exit 1
    fi

    PROFILE_INDEX=$((PROFILE_CHOICE - 1))

    if [ $PROFILE_INDEX -lt 0 ] || [ $PROFILE_INDEX -ge ${#PROFILE_NAMES[@]} ]; then
        echo "Error: Invalid selection"
        exit 1
    fi

    PROFILE_NAME="${PROFILE_NAMES[$PROFILE_INDEX]}"
    echo "Selected profile: $PROFILE_NAME"
else
    echo "❌ Error: No Databricks profiles found"
    echo "Please run 'databricks auth login' first"
    exit 1
fi

echo
echo "Fetching list of database instances..."

# List all database instances
set +e
DB_INSTANCES=$(databricks database list-database-instances --profile "$PROFILE_NAME" --output json 2>/dev/null)
LIST_EXIT_CODE=$?
set -e

if [ $LIST_EXIT_CODE -ne 0 ]; then
    echo "❌ Error: Could not list database instances"
    echo "Please check your authentication and permissions"
    exit 1
fi

# Parse and display instances
INSTANCE_NAMES=$(echo "$DB_INSTANCES" | jq -r '.[].instance_name' 2>/dev/null || echo "")

if [ -z "$INSTANCE_NAMES" ]; then
    echo "✓ No database instances found in this workspace"
    echo
    echo "You can now run the quickstart script without conflicts:"
    echo "  ./scripts/quickstart.sh"
    exit 0
fi

echo
echo "Found database instances:"
echo "-------------------------------------------------------------------"
echo "$INSTANCE_NAMES" | nl
echo "-------------------------------------------------------------------"
echo

# Check for chatbot-related instances
CHATBOT_INSTANCES=$(echo "$INSTANCE_NAMES" | grep -i "chatbot" || echo "")

if [ -n "$CHATBOT_INSTANCES" ]; then
    echo "Detected chatbot-related instances:"
    echo "$CHATBOT_INSTANCES"
    echo

    # Get the first chatbot instance as suggestion
    SUGGESTED_INSTANCE=$(echo "$CHATBOT_INSTANCES" | head -n 1)

    echo "Enter the name of the database instance to delete"
    echo "Or press Enter to delete: $SUGGESTED_INSTANCE"
    read -r INSTANCE_TO_DELETE

    if [ -z "$INSTANCE_TO_DELETE" ]; then
        INSTANCE_TO_DELETE="$SUGGESTED_INSTANCE"
    fi
else
    echo "Enter the name of the database instance to delete:"
    read -r INSTANCE_TO_DELETE

    if [ -z "$INSTANCE_TO_DELETE" ]; then
        echo "Error: Instance name is required"
        exit 1
    fi
fi

# Verify the instance exists
if ! echo "$INSTANCE_NAMES" | grep -q "^$INSTANCE_TO_DELETE$"; then
    echo "❌ Error: Instance '$INSTANCE_TO_DELETE' not found"
    echo "Please check the name and try again"
    exit 1
fi

echo
echo "⚠️  About to delete database instance: $INSTANCE_TO_DELETE"
echo
echo "This will:"
echo "  - Permanently delete the database instance"
echo "  - Delete all data stored in this database"
echo "  - Free up resources in your workspace"
echo

if prompt_yes_no "Are you sure you want to delete this database instance?" "N"; then
    echo
    echo "Deleting database instance '$INSTANCE_TO_DELETE'..."

    set +e
    databricks database delete-database-instance "$INSTANCE_TO_DELETE" --profile "$PROFILE_NAME"
    DELETE_EXIT_CODE=$?
    set -e

    if [ $DELETE_EXIT_CODE -eq 0 ]; then
        echo "✓ Database instance deleted successfully"
        echo
        echo "You can now run the quickstart script:"
        echo "  ./scripts/quickstart.sh"
    else
        echo "❌ Error: Failed to delete database instance"
        echo "Please check the error message above and try again"
        exit 1
    fi
else
    echo "Deletion cancelled"
fi

echo
echo "==================================================================="
