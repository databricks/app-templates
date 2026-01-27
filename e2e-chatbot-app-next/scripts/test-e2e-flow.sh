#!/bin/bash

# E2E Test Script for Chatbot Application
# Tests the complete flow: create chat, send message, submit feedback, verify feedback
#
# Usage: ./scripts/test-e2e-flow.sh [user-id] [user-email]
#
# If no user ID provided, will fetch from session API using CLI auth

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE="http://localhost:3001"
CLIENT_BASE="http://localhost:3000"

# Default test user (will be fetched from session if not provided)
TEST_USER_ID="${1:-}"
TEST_USER_EMAIL="${2:-test@example.com}"

# Function to print colored output
print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Function to make authenticated API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"

    if [ -z "$TEST_USER_ID" ]; then
        print_error "User ID not set. Cannot make authenticated API calls."
        exit 1
    fi

    local headers=(
        -H "Content-Type: application/json"
        -H "X-Forwarded-User: $TEST_USER_ID"
        -H "X-Forwarded-Email: $TEST_USER_EMAIL"
    )

    if [ "$method" = "GET" ]; then
        curl -s "${headers[@]}" "$API_BASE$endpoint"
    else
        curl -s -X "$method" "${headers[@]}" -d "$data" "$API_BASE$endpoint"
    fi
}

# Function to extract JSON field
extract_json() {
    local json="$1"
    local field="$2"
    echo "$json" | grep -o "\"$field\":\"[^\"]*\"" | cut -d'"' -f4 | head -1
}

# Check if servers are running
check_servers() {
    print_step "Checking if servers are running..."

    if ! curl -s "$API_BASE/api/session" -H "X-Forwarded-User: test" > /dev/null 2>&1; then
        print_error "Backend server not responding at $API_BASE"
        print_warning "Start the server with: npm run dev"
        exit 1
    fi
    print_success "Backend server is running"

    if ! curl -s "$CLIENT_BASE" > /dev/null 2>&1; then
        print_warning "Frontend server not responding at $CLIENT_BASE"
        print_warning "This is optional - testing backend only"
    else
        print_success "Frontend server is running"
    fi
}

# Get user session
get_session() {
    print_step "Getting user session..."

    # If user ID not provided, use default test user
    if [ -z "$TEST_USER_ID" ]; then
        # Generate a unique test user ID
        TEST_USER_ID="test-user-$(date +%s)"
        TEST_USER_EMAIL="test-e2e@example.com"
        print_success "Using test user: $TEST_USER_EMAIL (ID: $TEST_USER_ID)"
    else
        print_success "Using provided user: $TEST_USER_EMAIL (ID: $TEST_USER_ID)"
    fi

    # Verify session works
    local session=$(curl -s "$API_BASE/api/session" \
        -H "X-Forwarded-User: $TEST_USER_ID" \
        -H "X-Forwarded-Email: $TEST_USER_EMAIL")

    if echo "$session" | grep -q '"user"'; then
        print_success "Session verified"
    else
        print_error "Session verification failed"
        echo "Response: $session"
        exit 1
    fi
}

# Test 1: Create a new chat by sending a message
test_create_chat() {
    print_step "Test 1: Creating new chat with message..."

    # Generate UUIDs for chat and message
    CHAT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    local message_id=$(uuidgen | tr '[:upper:]' '[:lower:]')

    local request_data="{
        \"id\": \"$CHAT_ID\",
        \"message\": {
            \"id\": \"$message_id\",
            \"role\": \"user\",
            \"parts\": [
                {
                    \"type\": \"text\",
                    \"text\": \"Hello! This is an e2e test message. Please respond briefly.\"
                }
            ]
        },
        \"selectedChatModel\": \"chat-model\",
        \"selectedVisibilityType\": \"private\"
    }"

    # Stream the response and capture the first few chunks
    print_warning "Sending message (this will stream)..."
    local response=$(api_call POST /api/chat "$request_data" | head -c 5000)

    # Check if we got a response (streaming started)
    if echo "$response" | grep -q '"type"'; then
        print_success "Chat created and streaming started: $CHAT_ID"
    else
        print_error "Failed to create chat"
        echo "Response preview:"
        echo "$response" | head -20
        exit 1
    fi

    # Wait for the message to be fully processed and saved
    print_warning "Waiting for message to be saved..."
    sleep 5
}

# Test 2: Fetch chat metadata
test_get_chat() {
    print_step "Test 2: Fetching chat metadata..."

    local chat=$(api_call GET "/api/chat/$CHAT_ID")

    if echo "$chat" | grep -q '"id"'; then
        local title=$(extract_json "$chat" "title")
        print_success "Chat metadata retrieved: $title"
    else
        print_error "Failed to fetch chat metadata"
        echo "Response: $chat"
        exit 1
    fi
}

# Test 3: Fetch messages
test_get_messages() {
    print_step "Test 3: Fetching chat messages..."

    local messages=$(api_call GET "/api/messages/$CHAT_ID")

    # Count messages (should be at least 2: user + assistant)
    local message_count=$(echo "$messages" | grep -o '"id"' | wc -l)

    if [ "$message_count" -ge 2 ]; then
        print_success "Messages retrieved: $message_count messages"

        # Extract first assistant message ID for feedback test
        MESSAGE_ID=$(echo "$messages" | grep -o '"id":"[^"]*"' | grep -v "$CHAT_ID" | cut -d'"' -f4 | head -2 | tail -1)

        if [ -z "$MESSAGE_ID" ]; then
            print_warning "Could not extract message ID from response"
        else
            print_success "Assistant message ID: $MESSAGE_ID"
        fi
    else
        print_error "Expected at least 2 messages, got $message_count"
        echo "Response preview:"
        echo "$messages" | head -20
        exit 1
    fi
}

# Test 4: Submit feedback
test_submit_feedback() {
    print_step "Test 4: Submitting thumbs up feedback..."

    if [ -z "$MESSAGE_ID" ]; then
        print_error "No message ID available for feedback"
        exit 1
    fi

    local feedback_data="{
        \"messageId\": \"$MESSAGE_ID\",
        \"chatId\": \"$CHAT_ID\",
        \"feedbackType\": \"thumbs_up\"
    }"

    local feedback=$(api_call POST /api/feedback "$feedback_data")

    if echo "$feedback" | grep -q '"id"'; then
        FEEDBACK_ID=$(extract_json "$feedback" "id")
        print_success "Feedback submitted: $FEEDBACK_ID"
    else
        print_error "Failed to submit feedback"
        echo "Response: $feedback"
        exit 1
    fi
}

# Test 5: Verify feedback
test_get_feedback() {
    print_step "Test 5: Verifying feedback was saved..."

    local feedback_list=$(api_call GET "/api/feedback/chat/$CHAT_ID")

    if echo "$feedback_list" | grep -q "$FEEDBACK_ID"; then
        local feedback_type=$(echo "$feedback_list" | grep -o '"feedbackType":"[^"]*"' | cut -d'"' -f4 | head -1)
        print_success "Feedback verified: $feedback_type on message $MESSAGE_ID"
    else
        print_error "Feedback not found in chat feedback list"
        echo "Response: $feedback_list"
        exit 1
    fi
}

# Test 6: Update feedback
test_update_feedback() {
    print_step "Test 6: Updating feedback to thumbs down..."

    local update_data="{
        \"messageId\": \"$MESSAGE_ID\",
        \"chatId\": \"$CHAT_ID\",
        \"feedbackType\": \"thumbs_down\"
    }"

    # Submit again with different type (should update existing)
    local updated=$(api_call POST /api/feedback "$update_data")

    if echo "$updated" | grep -q "thumbs_down"; then
        print_success "Feedback updated to thumbs_down"
    else
        print_error "Failed to update feedback"
        echo "Response: $updated"
        exit 1
    fi
}

# Test 7: Get chat history
test_get_history() {
    print_step "Test 7: Fetching chat history..."

    local history=$(api_call GET /api/history)

    if echo "$history" | grep -q "$CHAT_ID"; then
        local chat_count=$(echo "$history" | grep -o '"id"' | wc -l)
        print_success "Chat history retrieved: $chat_count chats found"
    else
        print_error "Chat not found in history"
        echo "Response preview:"
        echo "$history" | head -20
        exit 1
    fi
}

# Main execution
main() {
    echo ""
    echo "=========================================="
    echo "  E2E Chatbot Application Test Suite"
    echo "=========================================="
    echo ""

    check_servers
    get_session

    echo ""
    echo "Running tests with:"
    echo "  User ID: $TEST_USER_ID"
    echo "  Email: $TEST_USER_EMAIL"
    echo ""

    # Run all tests
    test_create_chat
    test_get_chat
    test_get_messages
    test_submit_feedback
    test_get_feedback
    test_update_feedback
    test_get_history

    echo ""
    echo "=========================================="
    print_success "All tests passed!"
    echo "=========================================="
    echo ""
    echo "Test artifacts:"
    echo "  Chat ID: $CHAT_ID"
    echo "  Message ID: $MESSAGE_ID"
    echo "  Feedback ID: $FEEDBACK_ID"
    echo ""
    echo "View in browser:"
    echo "  $CLIENT_BASE/chat/$CHAT_ID"
    echo ""
}

# Run main function
main "$@"
