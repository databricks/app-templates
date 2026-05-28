# Secure Databricks Flask App

This application demonstrates best practices for building secure Databricks Flask apps with comprehensive security features.

## Security Features

### 1. OBO (On-Behalf-Of-User Authorization)
**On-Behalf-Of-User (OBO) Authorization** enables the application to execute SQL queries using the authenticated user's access token rather than a service account token. This ensures that all database operations are performed with the user's permissions, maintaining proper access control and audit trails while the app acts as an intermediary.

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
  
  Reference: [Databricks IDENTIFIER clause documentation](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-names-identifier-clause)

- **CSRF Protection**: Built-in CSRF token validation using Flask-WTF

- **Input Sanitization**: All user inputs and query results are escaped using MarkupSafe to prevent XSS attacks

- **Secure Token Handling**: User access tokens are handled securely via headers

**Note:** App creators can extend this application with additional security features based on their specific requirements, such as rate limiting, user audit logging, or custom authentication mechanisms.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABRICKS_HOST` | Your Databricks workspace hostname | Auto |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID | Yes |
| `DATABRICKS_APP_NAME` | Name of your Databricks app | Auto |
| `DATABRICKS_APP_URL` | URL where your app is accessible | Auto |
| `SERVER_PORT` | Port to run the application (default: 8000) | No |
| `CORS_ENABLE` | Enable CORS headers (default: false) | No |

## Configuration

1. If you want to add more libraries add them in requirements.txt

2. Configure your `app.yaml` with required environment variables

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

- **app.py** - Main Flask application file containing route handlers, security header configurations, CSRF protection setup, SQL injection protection using IDENTIFIER clause, and SQL query execution logic with OBO (On-Behalf-Of-User) token handling.

- **app.yaml** - Databricks app configuration file that defines environment variables and deployment settings for running the Flask application on Databricks Apps platform.

- **requirements.txt** - Python dependencies file listing all required packages (Flask-WTF, Flask-CORS, MarkupSafe, pandas) with pinned versions for consistent deployments.

- **templates/index.html** - Main HTML template providing the user interface with CSRF token embedding, query input forms, and dynamic results display with proper XSS protection.

- **static/css/style.css** - Stylesheet containing all visual styling for the application including responsive layout, forms, tables, error messages, and navigation components.

- **static/js/app.js** - Client-side JavaScript handling AJAX form submissions, CSRF token management, dynamic query preview updates, and error handling without page reloads.


