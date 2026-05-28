from flask import Flask, render_template, request, jsonify
from databricks import sql
from databricks.sdk.core import Config
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem
from markupsafe import escape
import os
import re

app = Flask(__name__)

# Initialize Databricks Config - automatically detects DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET
# These environment variables are automatically injected by Databricks Apps
cfg = Config()
w = WorkspaceClient()

# Configuration from environment variables
SERVER_PORT = int(os.environ.get('SERVER_PORT', 8000))
APP_URL = os.environ.get('DATABRICKS_APP_URL')
CORS_ENABLE = os.environ.get('CORS_ENABLE', 'false').lower() == 'true'

# Databricks warehouse configuration
DATABRICKS_WAREHOUSE_ID = os.environ.get('DATABRICKS_WAREHOUSE_ID')

# Validate required environment variables
if not DATABRICKS_WAREHOUSE_ID:
    raise ValueError("DATABRICKS_WAREHOUSE_ID environment variable is required")
if not APP_URL:
    raise ValueError("DATABRICKS_APP_URL environment variable is required")


# Regex pattern for origin validation only
ORIGIN_REGEX = re.compile(r'^[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$')

def validate_origin():
    """
    Validate Origin header for CSRF protection.
    Returns: (is_valid, error_message)
    """
    origin = request.headers.get('Origin')
    
    # If Origin header is not present, empty, or null - ALLOW
    if origin is None or origin == '' or origin == 'null':
        return True, None
    
    # Origin is present - validate it
    # First check if origin contains only valid characters
    if not ORIGIN_REGEX.match(origin):
        return False, "Invalid Origin header format - contains invalid characters"
    
    # Check if it starts with https://
    if not origin.startswith('https://'):
        return False, "Origin must use HTTPS protocol"
    
    # Normalize both values to lowercase for comparison
    origin_lower = origin.lower()
    expected_origin_lower = APP_URL.lower()
    
    # Compare the origins (without considering ports or trailing slashes)
    # Remove trailing slashes for comparison
    origin_normalized = origin_lower.rstrip('/')
    expected_normalized = expected_origin_lower.rstrip('/')
    
    if origin_normalized == expected_normalized:
        return True, None
    else:
        return False, f"Origin header mismatch. Expected: {APP_URL}, Got: {origin}"

app.config['DEBUG'] = False


@app.before_request
def csrf_protect():
    """Check Origin header for all requests"""
    is_valid, error_message = validate_origin()
    if not is_valid:
        return jsonify({'error': escape(error_message)}), 403

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

def execute_sql_query_with_params(pickup_zip_value, user_token):
    """
    Execute SQL query using OBO (On-Behalf-Of-User) authorization with parameterized query.
    
    Uses StatementParameterListItem for SQL injection protection.
    The query uses a fixed table (samples.nyctaxi.trips) and parameterizes user input.
    
    The user's access token is passed to act on behalf of the user.
    """
    if not user_token:
        raise ValueError("User token is required for SQL execution")
    
    # Create parameterized query - user input is safely passed as parameter
    query = "SELECT * FROM samples.nyctaxi.trips WHERE pickup_zip = :pickup_zip LIMIT 10"
    
    # Use StatementParameterListItem for safe parameterization
    param_list = [StatementParameterListItem(name="pickup_zip", value=str(pickup_zip_value))]
    
    # Execute using Databricks SDK with user token for OBO
    # Note: We need to use sql.connect for OBO with user token
    conn = sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{DATABRICKS_WAREHOUSE_ID}",
        access_token=user_token
    )
    
    with conn.cursor() as cursor:
        # Note: databricks-sql-connector does not support StatementParameterListItem directly
        # We use standard parameter binding with ? placeholder
        parameterized_query = "SELECT * FROM samples.nyctaxi.trips WHERE pickup_zip = ? LIMIT 10"
        cursor.execute(parameterized_query, [str(pickup_zip_value)])
        df = cursor.fetchall_arrow().to_pandas()
        
        if len(df) > 0:
            return {
                'columns': [escape(str(col)) for col in df.columns.tolist()],
                'rows': [[escape(str(cell)) for cell in row] for row in df.values.tolist()],
                'row_count': len(df),
                'has_data': True,
            }
        else:
            return {
                'columns': [escape(str(col)) for col in df.columns.tolist()] if len(df.columns) > 0 else [],
                'rows': [],
                'row_count': 0,
                'has_data': False,
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
        pickup_zip = request.form.get('pickup_zip', '').strip()
        
        if not pickup_zip:
            error_message = "Pickup ZIP code is required."
        elif not user_token:
            error_message = "User token is required for query execution."
        else:
            try:
                # Execute parameterized query (SQL injection safe)
                query_display = f"SELECT * FROM samples.nyctaxi.trips WHERE pickup_zip = '{pickup_zip}' LIMIT 10"
                parsed_data = execute_sql_query_with_params(pickup_zip, user_token)
                
                query_info = {
                    'query': escape(query_display),
                    'status': 'executed',
                    'result_count': parsed_data['row_count'] if parsed_data else 0,
                    'has_data': parsed_data['has_data'] if parsed_data else False
                }
            except Exception as e:
                error_message = "Query execution failed. Please check your inputs and permissions."
    
    elif request.method in ['PUT', 'DELETE', 'PATCH']:
        # Handle other state-changing methods
        error_message = f"{request.method} method not implemented for this endpoint."
    
    # For all methods, return the template
    return render_template('index.html', 
                         user=user, 
                         user_token=user_token,
                         result_data=result_data,
                         parsed_data=parsed_data,
                         error_message=error_message,
                         query_info=query_info)

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=SERVER_PORT, debug=False)