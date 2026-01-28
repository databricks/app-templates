#!/bin/bash
# Test script to check if trace IDs are returned in response headers from agent serving endpoint

set -e

echo "Testing Trace ID Headers from Agent Serving Endpoint"
echo "====================================================="
echo ""

# Load environment variables
if [ -f .env.local ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
fi

# Check if required variables are set
if [ -z "$DATABRICKS_SERVING_ENDPOINT" ]; then
    echo "❌ ERROR: DATABRICKS_SERVING_ENDPOINT not set"
    exit 1
fi

if [ -z "$DATABRICKS_CONFIG_PROFILE" ]; then
    echo "❌ ERROR: DATABRICKS_CONFIG_PROFILE not set"
    exit 1
fi

echo "Endpoint: $DATABRICKS_SERVING_ENDPOINT"
echo "Profile: $DATABRICKS_CONFIG_PROFILE"
echo ""

# Get Databricks host and token
HOST=$(databricks auth describe --profile "$DATABRICKS_CONFIG_PROFILE" --output json 2>/dev/null | jq -r '.details.host // .details.configuration.host.value')
TOKEN=$(databricks auth token --profile "$DATABRICKS_CONFIG_PROFILE")

if [ -z "$HOST" ] || [ -z "$TOKEN" ]; then
    echo "❌ ERROR: Could not get host or token from Databricks CLI"
    exit 1
fi

echo "Host: $HOST"
echo ""

# Test 1: Check response headers from non-streaming request
echo "Test 1: Non-streaming request headers"
echo "======================================="

RESPONSE=$(curl -s -D - "${HOST}/serving-endpoints/${DATABRICKS_SERVING_ENDPOINT}/invocations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "databricks_options": {"return_trace": true}
  }')

echo "Response headers:"
echo "$RESPONSE" | sed -n '1,/^\r$/p' | grep -iE "(trace|mlflow|x-databricks)" || echo "  No trace-related headers found"
echo ""

# Test 2: Check response body for trace_id
echo "Test 2: Response body trace_id field"
echo "====================================="

BODY=$(echo "$RESPONSE" | sed -n '/^\r$/,$p' | tail -n +2)
TRACE_ID=$(echo "$BODY" | jq -r '.trace_id // empty' 2>/dev/null)

if [ -n "$TRACE_ID" ]; then
    echo "✅ Found trace_id in response body: $TRACE_ID"
else
    echo "❌ No trace_id field in response body"
    echo "Response body structure:"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 3: Check SSE streaming response
echo "Test 3: Streaming response (first 50 events)"
echo "============================================="

echo "Checking SSE events for trace metadata..."
curl -s "${HOST}/serving-endpoints/${DATABRICKS_SERVING_ENDPOINT}/invocations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "databricks_options": {"return_trace": true},
    "stream": true
  }' | head -50 | grep -iE "(trace|mlflow)" || echo "  No trace-related fields in first 50 events"

echo ""
echo "====================================================="
echo "Test complete. Check output above for trace ID availability."
