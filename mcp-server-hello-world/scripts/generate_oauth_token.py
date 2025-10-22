#!/usr/bin/env python3
"""
Generate a workspace-level OAuth token for Databricks.

This script implements the OAuth U2M (User-to-Machine) authorization flow
to generate access tokens for Databricks workspace-level operations.

Based on: https://docs.databricks.com/aws/en/dev-tools/auth/oauth-u2m?language=CLI

Usage:
    python generate_oauth_token.py --host <workspace-url> --scopes <scopes>

Example:
    python generate_oauth_token.py \\
        --host https://dbc-a1b2345c-d6e7.cloud.databricks.com \\
        --scopes "all-apis offline_access"
"""

import argparse
import base64
import hashlib
import json
import secrets
import string
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import requests

# OAuth client ID for Databricks CLI
CLIENT_ID = "databricks-cli"


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler to capture OAuth callback."""

    authorization_code = None
    state_value = None

    def do_GET(self):
        """Handle GET request from OAuth callback."""
        # Parse the query parameters
        query_components = parse_qs(urlparse(self.path).query)

        # Extract code and state
        OAuthCallbackHandler.authorization_code = query_components.get("code", [None])[0]
        OAuthCallbackHandler.state_value = query_components.get("state", [None])[0]

        # Send response to browser
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()

        if OAuthCallbackHandler.authorization_code:
            message = """
            <html>
            <body>
                <h2>Authorization Successful!</h2>
                <p>You can close this window and return to the terminal.</p>
            </body>
            </html>
            """
        else:
            message = """
            <html>
            <body>
                <h2>Authorization Failed</h2>
                <p>No authorization code received. Please try again.</p>
            </body>
            </html>
            """

        self.wfile.write(message.encode())

    def log_message(self, format, *args):
        """Suppress log messages."""
        pass


def generate_pkce_pair():
    """
    Generate a PKCE code verifier and challenge.

    Returns:
        tuple: (code_verifier, code_challenge)
    """
    # Allowed characters for the code verifier, per PKCE spec
    allowed_chars = string.ascii_letters + string.digits + "-._~"

    # Generate a secure code verifier (43–128 characters)
    code_verifier = "".join(secrets.choice(allowed_chars) for _ in range(64))

    # Create the SHA256 hash of the code verifier
    sha256_hash = hashlib.sha256(code_verifier.encode()).digest()

    # Base64-url-encode the hash and strip any trailing '=' padding
    code_challenge = base64.urlsafe_b64encode(sha256_hash).decode().rstrip("=")

    return code_verifier, code_challenge


def get_authorization_code(host, client_id, redirect_uri, scopes, code_challenge):
    """
    Open browser to get authorization code from user.

    Args:
        host: Databricks workspace URL
        client_id: OAuth client ID
        redirect_uri: Redirect URI for callback
        scopes: Space-separated OAuth scopes
        code_challenge: PKCE code challenge

    Returns:
        str: Authorization code
    """
    # Generate a random state for CSRF protection
    state = secrets.token_urlsafe(32)

    # Build the authorization URL
    auth_params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "scope": scopes,
    }

    # Remove trailing slash from host if present
    host = host.rstrip("/")

    auth_url = f"{host}/oidc/v1/authorize?{urlencode(auth_params)}"

    print(f"\nOpening browser for authorization...", file=sys.stderr)
    print(
        f"If the browser doesn't open automatically, visit this URL:\n{auth_url}\n", file=sys.stderr
    )

    # Start local HTTP server to receive callback
    redirect_port = int(urlparse(redirect_uri).port or 8020)
    server = HTTPServer(("localhost", redirect_port), OAuthCallbackHandler)

    # Open browser
    webbrowser.open(auth_url)

    print(f"Waiting for authorization callback on {redirect_uri}...", file=sys.stderr)

    # Wait for callback (single request)
    server.handle_request()

    # Validate state
    if OAuthCallbackHandler.state_value != state:
        raise ValueError("State mismatch! Possible CSRF attack. Aborting.")

    if not OAuthCallbackHandler.authorization_code:
        raise ValueError("No authorization code received from callback.")

    return OAuthCallbackHandler.authorization_code


def exchange_code_for_token(
    host, client_id, redirect_uri, code_verifier, authorization_code, scopes
):
    """
    Exchange authorization code for access token.

    Args:
        host: Databricks workspace URL
        client_id: OAuth client ID
        redirect_uri: Redirect URI used in authorization
        code_verifier: PKCE code verifier
        authorization_code: Authorization code from browser callback
        scopes: Space-separated OAuth scopes

    Returns:
        dict: Token response containing access_token, refresh_token, etc.
    """
    # Remove trailing slash from host if present
    host = host.rstrip("/")

    token_url = f"{host}/oidc/v1/token"

    token_data = {
        "client_id": client_id,
        "grant_type": "authorization_code",
        "scope": scopes,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "code": authorization_code,
    }

    print(f"\nExchanging authorization code for access token...", file=sys.stderr)

    response = requests.post(token_url, data=token_data)

    if response.status_code != 200:
        raise ValueError(
            f"Failed to exchange code for token: {response.status_code} - {response.text}"
        )

    return response.json()


def main():
    parser = argparse.ArgumentParser(
        description="Generate a workspace-level OAuth token for Databricks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate token with default scopes
  python generate_oauth_token.py \\
      --host https://dbc-a1b2345c-d6e7.cloud.databricks.com

  # Generate token with custom scopes
  python generate_oauth_token.py \\
      --host https://dbc-a1b2345c-d6e7.cloud.databricks.com \\
      --scopes "clusters:read jobs:write"
        """,
    )

    parser.add_argument(
        "--host",
        required=True,
        help="Databricks workspace URL (e.g., https://dbc-a1b2345c-d6e7.cloud.databricks.com)",
    )

    parser.add_argument(
        "--scopes",
        default="all-apis offline_access",
        help='Space-separated OAuth scopes (default: "all-apis offline_access")',
    )

    parser.add_argument(
        "--redirect-uri",
        default="http://localhost:8020",
        help="Redirect URI for OAuth callback (default: http://localhost:8020)",
    )

    args = parser.parse_args()

    # Helper function to print progress to stderr
    def log_output(message):
        """Print progress messages to stderr."""
        print(message, file=sys.stderr)

    try:
        # Step 1: Generate PKCE pair
        log_output("=" * 70)
        log_output("Databricks OAuth Token Generator")
        log_output("=" * 70)
        log_output(f"\nWorkspace: {args.host}")
        log_output(f"Client ID: {CLIENT_ID}")
        log_output(f"Scopes: {args.scopes}")
        log_output("")

        code_verifier, code_challenge = generate_pkce_pair()
        log_output("✓ Generated PKCE code verifier and challenge")

        # Step 2: Get authorization code
        authorization_code = get_authorization_code(
            args.host, CLIENT_ID, args.redirect_uri, args.scopes, code_challenge
        )
        log_output(f"✓ Received authorization code")

        # Step 3: Exchange for token
        token_response = exchange_code_for_token(
            args.host,
            CLIENT_ID,
            args.redirect_uri,
            code_verifier,
            authorization_code,
            args.scopes,
        )
        log_output("✓ Successfully obtained access token!")
        log_output("")

        # Output results as JSON to stdout
        print(json.dumps(token_response, indent=2))

    except KeyboardInterrupt:
        log_output("\n\n✗ Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        log_output(f"\n\n✗ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
