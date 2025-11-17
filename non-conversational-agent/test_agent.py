#!/usr/bin/env python3
"""Simple test script for the non-conversational financial checklist agent."""

import json
import requests
import subprocess
from typing import Dict, Any, Optional
from urllib.parse import urlparse


def get_databricks_oauth_token(profile: Optional[str] = None) -> Optional[str]:
    """Get OAuth token from Databricks CLI."""
    try:
        cmd = ["databricks", "auth", "token"]
        if profile:
            cmd.extend(["--profile", profile])
            
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            return json.loads(result.stdout).get("access_token")
    except:
        pass
    return None


def is_localhost(url: str) -> bool:
    """Check if URL is localhost."""
    hostname = urlparse(url).hostname
    return hostname in ["localhost", "127.0.0.1", "::1"]


def test_agent(base_url: str = "http://localhost:8000", profile: Optional[str] = None) -> None:
    """Test the agent with a simple financial document question."""
    
    # Get token if needed
    token = None
    if not is_localhost(base_url):
        token = get_databricks_oauth_token(profile)
        if not token:
            print("❌ Failed to get OAuth token for remote endpoint")
            return
    
    # Test data
    data = {
        "document_text": "Total assets: $2,300,000. Total liabilities: $1,200,000. Shareholder's equity: $1,100,000. Net income: $450,000. Revenues: $1,700,000. Expenses: $1,250,000.",
        "questions": [
            {"text": "Do the documents contain a balance sheet?"},
            {"text": "Do the documents contain an income statement?"}
        ]
    }
    
    # Send request
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        response = requests.post(f"{base_url}/invocations", json=data, headers=headers, timeout=60)
        response.raise_for_status()
        result = response.json()
        
        print("✅ Test successful!")
        print(f"Questions answered: {len(result.get('results', []))}")
        for i, r in enumerate(result.get('results', []), 1):
            print(f"{i}. {r.get('question_text', '')}: {r.get('answer', '')}")
            
    except Exception as e:
        print(f"❌ Test failed: {e}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000", help="Agent URL")
    parser.add_argument("--profile", help="Databricks CLI profile to use for authentication")
    args = parser.parse_args()
    
    test_agent(args.url, args.profile)