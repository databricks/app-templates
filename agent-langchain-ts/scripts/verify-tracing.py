#!/usr/bin/env python3
"""
Verify MLflow tracing is working by searching for traces in the experiment.
Tests both before and after sending a request to the agent.
"""

import os
import sys
import time
import json
import subprocess
import requests
from datetime import datetime, timedelta

try:
    import mlflow
    from mlflow.tracking import MlflowClient
except ImportError:
    print("❌ mlflow package not installed. Installing...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "mlflow"])
    import mlflow
    from mlflow.tracking import MlflowClient

# Configuration
EXPERIMENT_ID = "98459650930273"  # Actual experiment ID used by deployed app
EXPERIMENT_NAME = "/Users/sid.murching@databricks.com/[dev sid_murching] agent-langchain-ts"
APP_URL = "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com"
DATABRICKS_PROFILE = "dogfood"

def get_auth_token():
    """Get Databricks auth token from CLI"""
    result = subprocess.run(
        ["databricks", "auth", "token", "--profile", DATABRICKS_PROFILE, "--output", "json"],
        capture_output=True,
        text=True,
        check=True
    )
    token_data = json.loads(result.stdout.strip())
    return token_data["access_token"]

def setup_mlflow():
    """Configure MLflow to connect to Databricks"""
    # Get Databricks host and token
    result = subprocess.run(
        ["databricks", "auth", "env", "--profile", DATABRICKS_PROFILE],
        capture_output=True,
        text=True,
        check=True
    )

    env_vars = {}
    for line in result.stdout.strip().split('\n'):
        if '=' in line:
            key, value = line.split('=', 1)
            env_vars[key] = value

    os.environ.update(env_vars)

    # Set MLflow tracking URI to Databricks
    mlflow.set_tracking_uri("databricks")

    print(f"✅ MLflow configured to use Databricks")
    print(f"   Host: {os.environ.get('DATABRICKS_HOST')}")
    print(f"   Experiment: {EXPERIMENT_NAME}")

def search_traces(filter_string=None, max_results=10):
    """Search for traces in the experiment"""
    try:
        client = MlflowClient()

        # Search for traces
        traces = mlflow.search_traces(
            experiment_ids=[EXPERIMENT_ID],
            filter_string=filter_string,
            max_results=max_results,
            order_by=["timestamp DESC"]
        )

        return traces
    except Exception as e:
        print(f"⚠️  Error searching traces: {e}")
        return None

def send_test_request(message):
    """Send a test request to the agent"""
    token = get_auth_token()

    response = requests.post(
        f"{APP_URL}/invocations",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        json={
            "input": [
                {
                    "role": "user",
                    "content": message
                }
            ],
            "stream": False
        },
        timeout=30
    )

    if response.ok:
        return response.json()
    else:
        print(f"❌ Request failed: {response.status_code}")
        print(f"   {response.text}")
        return None

def main():
    print("=" * 60)
    print("MLflow Tracing Verification")
    print("=" * 60)
    print()

    # Setup MLflow
    setup_mlflow()
    print()

    # Check for existing traces
    print("🔍 Searching for existing traces...")
    existing_traces = search_traces()

    if existing_traces is not None and len(existing_traces) > 0:
        print(f"✅ Found {len(existing_traces)} existing trace(s)")
        print()
        print("Most recent traces:")
        for i, trace in enumerate(existing_traces.head(5).itertuples(), 1):
            timestamp = trace.timestamp_ms
            request_id = trace.request_id
            print(f"   {i}. Trace ID: {request_id}")
            print(f"      Timestamp: {datetime.fromtimestamp(timestamp/1000)}")
            if hasattr(trace, 'tags') and trace.tags:
                print(f"      Tags: {trace.tags}")
            print()
    else:
        print("⚠️  No existing traces found in experiment")
        print()

    # Send a new test request
    print("=" * 60)
    print("Sending test request to agent...")
    print("=" * 60)
    print()

    test_message = f"Test trace verification at {datetime.now().isoformat()}: What is 42 * 137?"
    print(f"Message: {test_message}")
    print()

    response = send_test_request(test_message)

    if response:
        print("✅ Request successful!")
        print(f"   Output: {response.get('output', 'N/A')}")
        print()
    else:
        print("❌ Request failed")
        return 1

    # Wait for trace to be exported
    print("⏳ Waiting 10 seconds for trace to be exported...")
    time.sleep(10)
    print()

    # Search for new traces
    print("🔍 Searching for new traces (after test request)...")

    # Get traces from the last minute
    one_minute_ago = int((datetime.now() - timedelta(minutes=1)).timestamp() * 1000)
    filter_string = f"timestamp_ms > {one_minute_ago}"

    new_traces = search_traces(filter_string=filter_string)

    if new_traces is not None and len(new_traces) > 0:
        print(f"✅ Found {len(new_traces)} trace(s) from the last minute!")
        print()
        print("Recent traces:")
        for i, trace in enumerate(new_traces.head(5).itertuples(), 1):
            timestamp = trace.timestamp_ms
            request_id = trace.request_id
            print(f"   {i}. Trace ID: {request_id}")
            print(f"      Timestamp: {datetime.fromtimestamp(timestamp/1000)}")
            if hasattr(trace, 'tags') and trace.tags:
                print(f"      Tags: {trace.tags}")
            if hasattr(trace, 'request') and trace.request:
                print(f"      Request preview: {str(trace.request)[:100]}...")
            print()

        print("=" * 60)
        print("✅ SUCCESS: Tracing is working correctly!")
        print("=" * 60)
        print()
        print(f"View traces in MLflow UI:")
        print(f"https://e2-dogfood.staging.cloud.databricks.com/ml/experiments/{EXPERIMENT_ID}")
        return 0
    else:
        print("=" * 60)
        print("❌ FAILURE: No new traces found after test request")
        print("=" * 60)
        print()
        print("Possible issues:")
        print("1. Trace export may be delayed (try waiting longer)")
        print("2. Tracing configuration may not be working properly")
        print("3. Experiment ID may be incorrect")
        print()
        print("Check agent logs for tracing errors:")
        print(f"databricks apps logs agent-lc-ts-dev --follow")
        return 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
