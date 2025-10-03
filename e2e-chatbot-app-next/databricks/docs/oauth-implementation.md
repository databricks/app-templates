# Databricks OAuth Authentication Implementation

## Overview
This document describes the OAuth client credentials authentication implementation for Databricks serving endpoints.
The change is in the "oauth-token-vibe-code" branch.

## Authentication Flow
The system supports two authentication methods with automatic fallback:
1. **Personal Access Token (PAT)** - Direct token authentication
2. **OAuth Client Credentials** - Service principal authentication

## Environment Variables
- `DATABRICKS_HOST` - Databricks workspace URL (default: https://e2-dogfood.staging.cloud.databricks.com)
- `DATABRICKS_TOKEN` - Personal Access Token (takes priority if present)
- `DATABRICKS_CLIENT_ID` - OAuth service principal client ID
- `DATABRICKS_CLIENT_SECRET` - OAuth service principal secret
- `DATABRICKS_SERVING_ENDPOINT` - Serving endpoint name (default: agents_ml-bbqiu-annotationsv2)

## Priority Order
1. If `DATABRICKS_TOKEN` is set → Use PAT authentication
2. If `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` are set → Use OAuth
3. Otherwise → Throw error

## OAuth Implementation Details

### Token Management
- Tokens are cached in memory with automatic expiration handling
- 5-minute buffer before expiration for token refresh
- OAuth endpoint: `${DATABRICKS_HOST}/oidc/v1/token`
- Grant type: `client_credentials` with scope `all-apis`

### Code Structure
```typescript
// Token caching variables
let oauthToken: string | null = null;
let tokenExpiresAt: number = 0;

// Token acquisition function
async function getDatabricksToken(): Promise<string> {
  // Check for PAT first
  if (process.env.DATABRICKS_TOKEN) {
    return process.env.DATABRICKS_TOKEN;
  }

  // Use cached OAuth token if valid
  if (oauthToken && Date.now() < tokenExpiresAt) {
    return oauthToken;
  }

  // Mint new OAuth token
  // ... OAuth flow implementation
}
```

### Provider Configuration
The implementation uses conditional provider creation based on available credentials:
- PAT: Direct `createOpenAI()` with token
- OAuth: Proxy-based provider that resolves OAuth token asynchronously

## Testing
OAuth authentication was successfully tested and logs show:
```
Using OAuth authentication
Using OAuth client credentials for authentication
Minting new Databricks OAuth token...
OAuth token obtained, expires in 3600 seconds
```

## Files Modified
- `lib/ai/providers.ts` - Main OAuth implementation
- `app.yaml` - Added `DATABRICKS_SERVING_ENDPOINT` environment variable
- `components/message.tsx` - Added citation and generic tool call rendering

## Usage in Production
To use OAuth in production:
1. Set `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET`
2. Remove or comment out `DATABRICKS_TOKEN`
3. The system will automatically use OAuth authentication