# Secure Databricks Flask App

This application demonstrates best practices for building secure Databricks Flask apps with comprehensive security features.

## Security Features

### 1. App Authorization (Service Principal)
**App Authorization** uses a dedicated service principal that Databricks automatically provisions for each app. When you create a Databricks App, Databricks automatically injects the service principal credentials (`DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET`) into the app's environment. The app uses these credentials to authenticate via OAuth 2.0 and access Databricks resources with the permissions granted to the service principal. This ensures secure, auditable access control for all app operations.

Reference: [Databricks Apps Authorization Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)

### 2. CSP (Content Security Policy)
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

### 3. CORS (Cross-Origin Resource Sharing)
CORS headers are **disabled by default** for security. To enable CORS support, add the following environment variable in your `app.yaml`:

```yaml
env:
  - name: "CORS_ENABLE"
    value: "true"
```

**Example `app.yaml` with CORS enabled:**
```yaml
display_name: "Secure_Flask_App"
env:
  - name: "SERVER_PORT"
    value: "8000"
  - name: "DATABRICKS_WAREHOUSE_ID"
    valueFrom: "sql-warehouse"
  - name: "SQL_AUTHORIZED_USERS"
    value: "sql_user1@email.com,sql_user2@email.com"
  - name: "CORS_ENABLE"
    value: "true"
```

When enabled, the following CORS headers will be set:
- `Access-Control-Allow-Origin`: Configured app URL
- `Access-Control-Allow-Credentials`: false
- `Access-Control-Allow-Methods`: GET, POST, PUT, DELETE, PATCH
- `Access-Control-Allow-Headers`: Content-Type, X-Requested-With

## Additional Security Features

- **SQL Injection Protection**: Uses Databricks `IDENTIFIER` clause for safe parameterization of table and column names. The IDENTIFIER clause prevents SQL injection by interpreting user input as SQL identifiers (table/column names) in a safe manner, ensuring malicious SQL code cannot be injected through user inputs.
  ```python
  # Safe query using IDENTIFIER clause
  query = "SELECT IDENTIFIER(:column_name) FROM IDENTIFIER(:table_name) LIMIT 10"
  cursor.execute(query, {"column_name": column_name, "table_name": table_name})
  ```
  Reference: [Databricks IDENTIFIER clause documentation](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-names-identifier-clause)

- **CSRF Protection**: Built-in CSRF token validation using Flask-WTF

- **Input Sanitization**: All user inputs and query results are escaped using MarkupSafe to prevent XSS attacks

- **X-Content-Type-Options**: Set to `nosniff` to prevent MIME-sniffing attacks

- **Secure Credential Management**: Service Principal credentials are managed via environment variables or Databricks SDK configuration

- **SQL Authorization Control**: Basic user authorization example that restricts SQL query execution to a list of authorized users (configured via `SQL_AUTHORIZED_USERS` environment variable)

**Important Note on Authorization:** The SQL authorization implementation provided in this app is a **simple example** for demonstration purposes. App developers should implement their own Access Control List (ACL) logic based on their specific security requirements. Consider implementing more sophisticated authorization mechanisms such as:
- Integration with enterprise identity management systems (LDAP, Active Directory, etc.)
- Role-Based Access Control (RBAC)
- Dynamic permission checking via Databricks Unity Catalog
- OAuth scopes and fine-grained permissions
- Group-based access control

App creators can extend this application with additional security features based on their specific requirements, such as rate limiting, user audit logging, or custom authentication mechanisms.

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
| `SQL_AUTHORIZED_USERS` | Comma-separated list of usernames/emails authorized to execute SQL queries (e.g., `user1@email.com,user2@email.com`) | Yes |
| `SERVER_PORT` | Port to run the application (default: 8000) | No |
| `CORS_ENABLE` | Enable CORS headers (default: false) | No |

**About `SQL_AUTHORIZED_USERS`:**
This environment variable defines a whitelist of users who are permitted to execute SQL queries through the app. The app validates the current user's identity (obtained from the `X-Forwarded-Preferred-Username` header provided by Databricks) against this list. Users not in the list will receive an "Access denied" error when attempting to run queries. 

Format: Comma-separated list of usernames or email addresses (no spaces around commas recommended for clarity)
Example: `user1@company.com,user2@company.com,admin@company.com`

This is a basic example implementation. For production environments, consider implementing more sophisticated authorization mechanisms integrated with your enterprise identity management system.

## Configuration

1. If you want to add more libraries add them in requirements.txt

2. Configure your `app.yaml` with required environment variables

3. **Set Authorized SQL Users**: Update the `SQL_AUTHORIZED_USERS` environment variable in `app.yaml` with a comma-separated list of usernames/emails of users who should have permission to execute SQL queries through the app. 
   
   Example: `"sql_user1@email.com,sql_user2@email.com,admin@company.com"`
   
   Each user's identity is verified against the `X-Forwarded-Preferred-Username` header provided by Databricks. Users not in this list will receive an "Access denied" error when attempting to execute queries.
   
   **Note:** This is a basic example implementation. For production use, implement more sophisticated ACL logic tailored to your organization's security requirements.

## File Structure

```
secure-flask-app/
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

- **app.py** - Main Flask application file containing route handlers, security header configurations, CSRF protection setup, SQL injection protection using IDENTIFIER clause, and SQL query execution logic with Service Principal authentication.

- **app.yaml** - Databricks app configuration file that defines environment variables and deployment settings for running the Flask application on Databricks Apps platform.

- **requirements.txt** - Python dependencies file listing all required packages (Flask-WTF, Flask-CORS, MarkupSafe, pandas) with pinned versions for consistent deployments.

- **templates/index.html** - Main HTML template providing the user interface with CSRF token embedding, query input forms, and dynamic results display with proper XSS protection.

- **static/css/style.css** - Stylesheet containing all visual styling for the application including responsive layout, forms, tables, error messages, and navigation components.

- **static/js/app.js** - Client-side JavaScript handling AJAX form submissions, CSRF token management, dynamic query preview updates, and error handling without page reloads.


