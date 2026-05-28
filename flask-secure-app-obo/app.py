from flask import Flask, render_template, request, jsonify
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from databricks import sql
from databricks.sdk.core import Config
from databricks.sdk import WorkspaceClient
from markupsafe import escape
import os
import pandas as pd

app = Flask(__name__)

# Ensure environment variable is set correctly
SERVER_PORT = int(os.environ.get('SERVER_PORT', 8000))
APP_NAME = os.environ.get('DATABRICKS_APP_NAME')
DATABRICKS_HOST = os.environ.get('DATABRICKS_HOST')
DATABRICKS_WAREHOUSE_ID = os.environ.get('DATABRICKS_WAREHOUSE_ID')
APP_URL = os.environ.get('DATABRICKS_APP_URL')
CORS_ENABLE = os.environ.get('CORS_ENABLE', 'false').lower() == 'true'

# Validate required environment variables
if not DATABRICKS_HOST:
    raise ValueError("DATABRICKS_HOST environment variable is required")
if not DATABRICKS_WAREHOUSE_ID:
    raise ValueError("WAREHOUSE_HTTP_PATH environment variable is required")
if not APP_NAME:
    raise ValueError("APP_NAME environment variable is required")
if not APP_URL:
    raise ValueError("DATABRICKS_APP_URL environment variable is required")

# Initialize Databricks config and WorkspaceClient
cfg = Config()
w = WorkspaceClient()

def get_or_create_csrf_key():
    # Option 1: Using Databricks Secrets (Recommended for production)
    # This approach stores the CSRF key securely in Databricks secrets
    app_name = os.environ.get('DATABRICKS_APP_NAME')
    scope = f"{app_name}_secrets"
    
    try:
        return w.secrets.get_secret(scope=scope, key="csrf_key")
    except:
        new_key = os.urandom(64).hex()
        try:
            w.secrets.put_secret(scope=scope, key="csrf_key", string_value=new_key)
        except:
            pass
        return new_key
    
    # Option 2: Without Databricks Secrets (Simple approach for development/testing)
    # Uncomment the lines below and comment out Option 1 above to use this method
    # Note: This generates a new key on each restart, which will invalidate existing sessions
    # return os.urandom(64).hex()

app.config['SECRET_KEY'] = get_or_create_csrf_key()
app.config['WTF_CSRF_ENABLED'] = True
app.config['WTF_CSRF_TIME_LIMIT'] = 3600
app.config['WTF_CSRF_SSL_STRICT'] = True  # Require HTTPS for CSRF tokens
app.config['DEBUG'] = False

# Initialize CSRF protection
csrf = CSRFProtect(app)


@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    """Handle CSRF validation errors"""
    return jsonify({'error': 'CSRF token missing or invalid. Please refresh the page.'}), 400

@app.after_request
def set_security_headers(response):
    # CORS headers (optional, controlled by CORS_ENABLE environment variable)
    if CORS_ENABLE:
        response.headers['Access-Control-Allow-Origin'] = APP_URL
        response.headers['Access-Control-Allow-Credentials'] = 'false'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Requested-With'
    
    # Content Security Policy
    response.headers['Content-Security-Policy'] = (
        "default-src https:; "
        "script-src https:; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src https: data:; "
        "font-src https: data:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none';"
    )
    
    # Other security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    return response

def execute_sql_with_token(column_name, table_name, user_token):
    """
    Execute SQL query using OBO (On-Behalf-Of-User) authorization with SQL injection protection.
    
    Uses Databricks IDENTIFIER clause for safe parameterization of table and column names.
    The IDENTIFIER clause interprets string parameters as SQL identifiers (table/column names)
    in a SQL injection-safe manner.
    
    The user's access token is passed to execute queries on behalf of the user,
    maintaining proper access control and audit trails.
    
    Reference: 
    - Auth: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth
    - IDENTIFIER: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-names-identifier-clause
    """
    if not user_token:
        raise ValueError("User token is required for SQL execution")
    
    conn = sql.connect(
        server_hostname=DATABRICKS_HOST,
        http_path=f"/sql/1.0/warehouses/{DATABRICKS_WAREHOUSE_ID}",
        access_token=user_token
    )
    
    with conn.cursor() as cursor:
        # Use IDENTIFIER clause for SQL injection-safe parameterization of identifiers
        # Parameters are passed as a dictionary with named parameters
        query = "SELECT IDENTIFIER(:column_name) FROM IDENTIFIER(:table_name) LIMIT 10"
        parameters = {"column_name": column_name, "table_name": table_name}
        
        cursor.execute(query, parameters)
        df = cursor.fetchall_arrow().to_pandas()
        
        if len(df) > 0:
            return {
                'columns': [escape(str(col)) for col in df.columns.tolist()],
                'rows': [[escape(str(cell)) for cell in row] for row in df.values.tolist()],
                'row_count': len(df),
                'has_data': True,
                'dataframe': df
            }
        else:
            return {
                'columns': [escape(str(col)) for col in df.columns.tolist()] if len(df.columns) > 0 else [],
                'rows': [],
                'row_count': 0,
                'has_data': False,
                'dataframe': df
            }

@app.route('/', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def index():
    headers = request.headers
    user = escape(headers.get('X-Forwarded-Preferred-Username', 'Unknown User'))
    user_token = headers.get('x-forwarded-access-token')
    
    result_data = None
    parsed_data = None
    error_message = None
    query_info = None
    
    # Handle different HTTP methods
    if request.method == 'POST':
        
        column_name = request.form.get('column_name', '').strip()
        table_name = request.form.get('table_name', '').strip()
        
        if not column_name or not table_name:
            error_message = "Both column name and table name are required."
        elif not user_token:
            error_message = "User token is required for query execution."
        else:
            try:
                # Execute query with IDENTIFIER clause for SQL injection protection
                parsed_data = execute_sql_with_token(column_name, table_name, user_token)
                
                # Display query for user reference (HTML-escaped for XSS protection)
                query_display = f"SELECT {escape(column_name)} FROM {escape(table_name)} LIMIT 10"
                
                query_info = {
                    'query': query_display,
                    'status': 'executed',
                    'result_count': parsed_data['row_count'] if parsed_data else 0,
                    'has_data': parsed_data['has_data'] if parsed_data else False
                }
            except Exception as e:
                error_message = f"Query execution failed: {escape(str(e))}"
    
    elif request.method in ['PUT', 'DELETE', 'PATCH']:
        # Handle other state-changing methods
        error_message = f"{request.method} method not implemented for this endpoint."
    
    # For all methods, return the template with CSRF token
    return render_template('index.html', 
                         user=user, 
                         user_token=user_token,
                         result_data=result_data,
                         parsed_data=parsed_data,
                         error_message=error_message,
                         query_info=query_info)

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=SERVER_PORT)