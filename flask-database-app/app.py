from flask import Flask, render_template, request, redirect, url_for, flash, session, abort
import secrets
import psycopg
import os
import time
from databricks import sdk
from psycopg import sql
from psycopg_pool import ConnectionPool

# Database connection setup
workspace_client = sdk.WorkspaceClient()
postgres_password = None
last_password_refresh = 0
connection_pool = None

def refresh_oauth_token():
    """Refresh OAuth token if expired."""
    global postgres_password, last_password_refresh
    if postgres_password is None or time.time() - last_password_refresh > 900:
        print("Refreshing PostgreSQL OAuth token")
        try:
            postgres_password = workspace_client.config.oauth_token().access_token
            last_password_refresh = time.time()
        except Exception as e:
            print(f"❌ Failed to refresh OAuth token: {str(e)}")
            return False
    return True

def get_connection_pool():
    """Get or create the connection pool."""
    global connection_pool
    if connection_pool is None:
        refresh_oauth_token()
        conn_string = (
            f"dbname={os.getenv('PGDATABASE')} "
            f"user={os.getenv('PGUSER')} "
            f"password={postgres_password} "
            f"host={os.getenv('PGHOST')} "
            f"port={os.getenv('PGPORT')} "
            f"sslmode={os.getenv('PGSSLMODE', 'require')} "
            f"application_name={os.getenv('PGAPPNAME')}"
        )
        connection_pool = ConnectionPool(conn_string, min_size=2, max_size=10)
    return connection_pool

def get_connection():
    """Get a connection from the pool."""
    global connection_pool
    
    # Recreate pool if token expired
    if postgres_password is None or time.time() - last_password_refresh > 900:
        if connection_pool:
            connection_pool.close()
            connection_pool = None
    
    return get_connection_pool().connection()

def get_schema_name():
    """Get the schema name in the format {PGAPPNAME}_schema_{PGUSER}."""
    pgappname = os.getenv("PGAPPNAME", "my_app")
    pguser = os.getenv("PGUSER", "").replace('-', '')
    return f"{pgappname}_schema_{pguser}"

def schema_sql(query):
    """Compose a query, filling {schema} with the app's schema name quoted as a SQL identifier."""
    return sql.SQL(query).format(schema=sql.Identifier(get_schema_name()))

def init_database():
    """Initialize database schema and table."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql("CREATE SCHEMA IF NOT EXISTS {schema}"))
                cur.execute(schema_sql("""
                    CREATE TABLE IF NOT EXISTS {schema}.todos (
                        id SERIAL PRIMARY KEY,
                        task TEXT NOT NULL,
                        completed BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.commit()
                return True
    except Exception as e:
        print(f"Database initialization error: {e}")
        return False

def add_todo(task):
    """Add a new todo item."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql("INSERT INTO {schema}.todos (task) VALUES (%s)"), (task.strip(),))
                conn.commit()
                return True
    except Exception as e:
        print(f"Add todo error: {e}")
        return False

def get_todos():
    """Get all todo items."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql("SELECT id, task, completed, created_at FROM {schema}.todos ORDER BY created_at DESC"))
                return cur.fetchall()
    except Exception as e:
        print(f"Get todos error: {e}")
        return []

def toggle_todo(todo_id):
    """Toggle the completed status of a todo item."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql("UPDATE {schema}.todos SET completed = NOT completed WHERE id = %s"), (todo_id,))
                conn.commit()
                return True
    except Exception as e:
        print(f"Toggle todo error: {e}")
        return False

def delete_todo(todo_id):
    """Delete a todo item."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql("DELETE FROM {schema}.todos WHERE id = %s"), (todo_id,))
                conn.commit()
                return True
    except Exception as e:
        print(f"Delete todo error: {e}")
        return False

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY') or secrets.token_hex(32)

@app.before_request
def csrf_protect():
    """Issue a per-session CSRF token and require it on every POST."""
    token = session.setdefault('csrf_token', secrets.token_urlsafe(32))
    if request.method == 'POST' and not secrets.compare_digest(request.form.get('csrf_token', ''), token):
        abort(400, 'Invalid CSRF token')

# Initialize database
if not init_database():
    print("Failed to initialize database")

@app.route('/')
def index():
    """Main page showing all todos."""
    todos = get_todos()
    return render_template('index.html', todos=todos)

@app.route('/add', methods=['POST'])
def add_todo_route():
    """Add a new todo item."""
    task = request.form.get('task', '').strip()
    if task:
        if add_todo(task):
            flash('Todo added successfully!', 'success')
        else:
            flash('Failed to add todo.', 'error')
    else:
        flash('Please enter a task.', 'error')
    return redirect(url_for('index'))

@app.route('/toggle/<int:todo_id>', methods=['POST'])
def toggle_todo_route(todo_id):
    """Toggle the completed status of a todo item."""
    if toggle_todo(todo_id):
        flash('Todo updated successfully!', 'success')
    else:
        flash('Failed to update todo.', 'error')
    return redirect(url_for('index'))

@app.route('/delete/<int:todo_id>', methods=['POST'])
def delete_todo_route(todo_id):
    """Delete a todo item."""
    if delete_todo(todo_id):
        flash('Todo deleted successfully!', 'success')
    else:
        flash('Failed to delete todo.', 'error')
    return redirect(url_for('index'))

if __name__ == '__main__':
    host = os.getenv('FLASK_RUN_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_RUN_PORT', 8000))

    # Debug mode is off by default; set FLASK_DEBUG=1 to enable it for local development.
    app.run(host=host, port=port)
    print(f"Flask app running on http://{host}:{port}")
