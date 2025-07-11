import dash
from dash import html, dcc, Input, Output, State, callback_context
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

def init_database():
    """Initialize database schema and table."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                schema_name = get_schema_name()
                
                cur.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema_name)))
                cur.execute(sql.SQL("""
                    CREATE TABLE IF NOT EXISTS {}.todos (
                        id SERIAL PRIMARY KEY,
                        task TEXT NOT NULL,
                        completed BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """).format(sql.Identifier(schema_name)))
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
                schema = get_schema_name()
                cur.execute(sql.SQL("INSERT INTO {}.todos (task) VALUES (%s)").format(sql.Identifier(schema)), (task.strip(),))
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
                schema = get_schema_name()
                cur.execute(sql.SQL("SELECT id, task, completed, created_at FROM {}.todos ORDER BY created_at DESC").format(sql.Identifier(schema)))
                return cur.fetchall()
    except Exception as e:
        print(f"Get todos error: {e}")
        return []

def toggle_todo(todo_id):
    """Toggle the completed status of a todo item."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                schema = get_schema_name()
                cur.execute(sql.SQL("UPDATE {}.todos SET completed = NOT completed WHERE id = %s").format(sql.Identifier(schema)), (todo_id,))
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
                schema = get_schema_name()
                cur.execute(sql.SQL("DELETE FROM {}.todos WHERE id = %s").format(sql.Identifier(schema)), (todo_id,))
                conn.commit()
                return True
    except Exception as e:
        print(f"Delete todo error: {e}")
        return False

# Initialize Dash app
app = dash.Dash(__name__)

# Initialize database
if not init_database():
    print("Failed to initialize database")

# App layout
app.layout = html.Div([
    html.H1("📝 Todo List App", style={'textAlign': 'center', 'marginBottom': '30px'}),
    
    # Add new todo section
    html.Div([
        html.H3("➕ Add New Todo"),
        dcc.Input(
            id='new-todo-input',
            type='text',
            placeholder='What do you need to do?',
            style={'width': '70%', 'padding': '10px', 'marginRight': '10px'}
        ),
        html.Button(
            'Add Todo',
            id='add-todo-button',
            n_clicks=0,
            style={'padding': '10px 20px', 'backgroundColor': '#007bff', 'color': 'white', 'border': 'none', 'borderRadius': '5px'}
        ),
        html.Div(id='add-todo-message', style={'marginTop': '10px'})
    ], style={'marginBottom': '30px', 'padding': '20px', 'backgroundColor': '#f8f9fa', 'borderRadius': '10px'}),
    
    html.Hr(),
    
    # Todo list section
    html.Div([
        html.H3("📋 Your Todos"),
        html.Div(id='todos-container')
    ]),
    
    # Store for tracking changes
    dcc.Store(id='todos-store')
], style={'maxWidth': '800px', 'margin': '0 auto', 'padding': '20px'})

@app.callback(
    Output('todos-store', 'data'),
    [Input('add-todo-button', 'n_clicks'),
     Input('new-todo-input', 'n_submit'),
     Input({'type': 'todo-checkbox', 'index': dash.ALL}, 'value'),
     Input({'type': 'delete-button', 'index': dash.ALL}, 'n_clicks')],
    [State('new-todo-input', 'value')],
    prevent_initial_call=False
)
def manage_todos_store(add_clicks, submit_clicks, checkbox_values, delete_clicks, new_todo):
    """Manage todos store - handles initial load, adding, toggling, and deleting todos."""
    ctx = callback_context
    
    # Initial load - no triggers
    if not ctx.triggered:
        return get_todos()
    
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]
    
    # Handle adding new todo (both button click and Enter key)
    if (triggered_id == 'add-todo-button' or triggered_id == 'new-todo-input') and new_todo and new_todo.strip():
        if add_todo(new_todo.strip()):
            return get_todos()
    
    # Handle checkbox toggle
    elif 'todo-checkbox' in triggered_id:
        import json
        try:
            id_dict = json.loads(triggered_id)
            todo_id = id_dict['index']
            if toggle_todo(todo_id):
                return get_todos()
        except:
            pass
    
    # Handle delete
    elif 'delete-button' in triggered_id:
        import json
        try:
            id_dict = json.loads(triggered_id)
            todo_id = id_dict['index']
            if delete_todo(todo_id):
                return get_todos()
        except:
            pass
    
    return dash.no_update

@app.callback(
    [Output('todos-container', 'children'),
     Output('add-todo-message', 'children'),
     Output('new-todo-input', 'value')],
    [Input('todos-store', 'data'),
     Input('add-todo-button', 'n_clicks'),
     Input('new-todo-input', 'n_submit')],
    [State('new-todo-input', 'value')]
)
def update_todos_display(todos_data, add_clicks, submit_clicks, new_todo):
    """Update the display of todos and handle add todo messages."""
    ctx = callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0] if ctx.triggered else None
    
    # Handle adding new todo message and clear input (both button click and Enter key)
    if (triggered_id == 'add-todo-button' or triggered_id == 'new-todo-input') and new_todo and new_todo.strip():
        # Clear the input field after adding
        return display_todos(todos_data), "", ""
    
    return display_todos(todos_data), "", ""

def display_todos(todos_data):
    """Display todos in the UI."""
    if not todos_data:
        return html.Div("🎉 No todos yet! Add one above to get started.", 
                       style={'textAlign': 'center', 'color': '#6c757d', 'fontStyle': 'italic'})
    
    todo_items = []
    for todo_id, task, completed, created_at in todos_data:
        todo_item = html.Div([
            html.Div([
                # Checkbox
                dcc.Checklist(
                    id={'type': 'todo-checkbox', 'index': todo_id},
                    options=[{'label': '', 'value': 'completed'}],
                    value=['completed'] if completed else [],
                    style={'display': 'inline-block', 'marginRight': '10px'}
                ),
                # Task text
                html.Span(
                    task,
                    style={
                        'textDecoration': 'line-through' if completed else 'none',
                        'color': '#6c757d' if completed else 'black',
                        'flex': '1'
                    }
                ),
                # Delete button
                html.Button(
                    "🗑️",
                    id={'type': 'delete-button', 'index': todo_id},
                    style={
                        'backgroundColor': 'transparent',
                        'border': 'none',
                        'fontSize': '16px',
                        'cursor': 'pointer',
                        'marginLeft': '10px'
                    }
                )
            ], style={'display': 'flex', 'alignItems': 'center', 'padding': '10px', 'borderBottom': '1px solid #eee'})
        ])
        todo_items.append(todo_item)
    
    return todo_items

if __name__ == '__main__':
    app.run_server(debug=True)