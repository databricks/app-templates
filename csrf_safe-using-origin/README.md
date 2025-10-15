# Secure Databricks App (CSRF via Origin Header)

This application demonstrates best practices for building secure Databricks apps using **Origin header validation for CSRF protection** instead of CSRF tokens. This approach provides an alternative CSRF protection method while maintaining comprehensive security features.

## Security Features

### 1. CSRF Protection via Origin Header Validation
**Origin Header Validation** provides CSRF protection by validating the `Origin` HTTP header on every request. This method offers an alternative to token-based CSRF protection.

**How it works:**
- All state-changing requests (POST, PUT, DELETE, PATCH) are validated via the `@app.before_request` hook
- The app checks if the `Origin` header matches the expected app URL (`DATABRICKS_APP_URL`)
- Requests without an `Origin` header or with `Origin: null` are allowed (same-origin requests)
  - **Important:** Browsers typically don't send `Origin` headers with GET requests, so these are allowed by default
  - **Do NOT use GET requests for state-changing operations** (create, update, delete) - always use POST, PUT, DELETE, or PATCH for state changes
- When `Origin` is present, it must:
  - Use HTTPS protocol
  - Match the configured app URL (case-insensitive comparison)
  - Contain only valid characters

**Validation Logic:**
```python
# If Origin header is absent or null - ALLOW (same-origin)
# If Origin header is present:
#   - Must start with https://
#   - Must match APP_URL
#   - Must contain only valid characters
```

**Reference:** [OWASP CSRF Prevention Cheat Sheet - Verifying Origin](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#verifying-origin-with-standard-headers)

### 2. User Authorization (OBO - On-Behalf-Of-User)
**On-Behalf-Of-User (OBO) Authorization** enables the application to execute SQL queries using the authenticated user's access token. The user's identity and permissions are maintained throughout the query execution, ensuring proper access control based on Unity Catalog policies.

**How it works:**
- User's access token is retrieved from the `x-forwarded-access-token` header (provided by Databricks)
- SQL queries execute with the user's identity and permissions
- Unity Catalog enforces row-level filters, column masks, and other access controls
- All operations are audited under the user's identity

Reference: [Databricks Apps Authorization Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)

### 3. CSP (Content Security Policy)
The application enforces the following Content Security Policy to prevent XSS and injection attacks:

```
Content-Security-Policy: default-src https:; script-src https:; style-src 'self' 'unsafe-inline'; img-src https: data:; font-src https: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';
```

**Policy Details:**
- `default-src https:` - Only allow HTTPS resources by default
- `script-src https:` - Only allow scripts from HTTPS sources
- `style-src 'self' 'unsafe-inline'` - Allow styles from same origin and inline styles
- `img-src https: data:` - Allow images from HTTPS and data URIs
- `font-src https: data:` - Allow fonts from HTTPS and data URIs
- `object-src 'none'` - Block all plugins (Flash, Java, etc.)
- `base-uri 'self'` - Restrict base tag to same origin
- `frame-ancestors 'none'` - Prevent the page from being embedded in iframes (clickjacking protection)

### 4. CORS (Cross-Origin Resource Sharing)
CORS headers are **disabled by default** for security. To enable CORS support, add the following environment variable in your `app.yaml`:

```yaml
env:
  - name: "CORS_ENABLE"
    value: "true"
```

**Example `app.yaml` with CORS enabled:**
```yaml
display_name: "csrf-using-origin"
env:
  - name: "SERVER_PORT"
    value: "8000"
  - name: "DATABRICKS_WAREHOUSE_ID"
    valueFrom: "sql-warehouse"
  - name: "CORS_ENABLE"
    value: "true"
```

When enabled, the following CORS headers will be set:
- `Access-Control-Allow-Origin`: Configured app URL
- `Access-Control-Allow-Credentials`: false
- `Access-Control-Allow-Methods`: GET, POST, PUT, DELETE, PATCH
- `Access-Control-Allow-Headers`: Content-Type, X-Requested-With

## Additional Security Features

- **SQL Injection Protection**: Uses parameterized queries with placeholder binding (`?`) to prevent SQL injection attacks. User input is passed as query parameters, never directly concatenated into SQL statements. The application queries a fixed table (`samples.nyctaxi.trips`) and only accepts user input for the WHERE clause value (pickup_zip), which is safely parameterized.
  ```python
  # Safe parameterized query
  query = "SELECT * FROM samples.nyctaxi.trips WHERE pickup_zip = ? LIMIT 10"
  cursor.execute(query, [str(pickup_zip_value)])
  ```

- **Input Sanitization**: All user inputs and query results are escaped using MarkupSafe to prevent XSS attacks

- **X-Content-Type-Options**: Set to `nosniff` to prevent MIME-sniffing attacks

- **Secure Token Handling**: User access tokens are handled securely via headers

- **Unity Catalog Integration**: Query execution respects all Unity Catalog permissions, row filters, and column masks

## Environment Variables

### Automatically Injected by Databricks Apps

These variables are automatically set by Databricks when you deploy your app:

| Variable | Description | Auto-Injected |
|----------|-------------|---------------|
| `DATABRICKS_HOST` | Your Databricks workspace hostname | ✅ Yes |
| `DATABRICKS_CLIENT_ID` | App service principal OAuth client ID | ✅ Yes |
| `DATABRICKS_CLIENT_SECRET` | App service principal OAuth client secret | ✅ Yes |
| `DATABRICKS_APP_NAME` | Name of your Databricks app | ✅ Yes |
| `DATABRICKS_APP_URL` | URL where your app is accessible | ✅ Yes |

### Required Configuration

These variables must be configured in your `app.yaml`:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID | Yes |
| `SERVER_PORT` | Port to run the application (default: 8000) | No |
| `CORS_ENABLE` | Enable CORS headers (default: false) | No |

## Configuration

1. If you want to add more libraries add them in requirements.txt

2. Configure your `app.yaml` with required environment variables

3. **Enable User Authorization**: Ensure your Databricks app has user authorization scopes configured to access SQL warehouses on behalf of users. This is configured in the Databricks UI when creating or editing the app.

## File Structure

```
csrf-origin-app/
├── app.py
├── app.yaml
├── requirements.txt
├── README.md
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── templates/
    └── index.html
```

### File Descriptions

- **app.py** - Main Flask application file containing route handlers, Origin header validation for CSRF protection, security header configurations, and SQL query execution logic with parameterized queries (SQL injection protection) using user token (OBO) authentication.

- **app.yaml** - Databricks app configuration file that defines environment variables and deployment settings for running the Flask application on Databricks Apps platform.

- **requirements.txt** - Python dependencies file listing all required packages (Flask, databricks-sql-connector, databricks-sdk, pandas, MarkupSafe) with pinned versions for consistent deployments.

- **templates/index.html** - Main HTML template providing the user interface with query input forms and dynamic results display with XSS protection.

- **static/css/style.css** - Stylesheet containing all visual styling for the application including responsive layout, forms, tables, error messages, and navigation components.

- **static/js/app.js** - Client-side JavaScript handling form submissions, dynamic query preview updates, and error handling.



