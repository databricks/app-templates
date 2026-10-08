import streamlit as st
import psycopg
import os
import time
import re
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
            st.error(f"❌ Failed to refresh OAuth token: {str(e)}")
            st.stop()

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

def add_todo(task):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql("INSERT INTO {schema}.todos (task) VALUES (%s)"), (task.strip(),))
            conn.commit()

def get_todos():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql("SELECT id, task, completed, created_at FROM {schema}.todos ORDER BY created_at DESC"))
            return cur.fetchall()

def toggle_todo(todo_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql("UPDATE {schema}.todos SET completed = NOT completed WHERE id = %s"), (todo_id,))
            conn.commit()


def delete_todo(todo_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql("DELETE FROM {schema}.todos WHERE id = %s"), (todo_id,))
            conn.commit()

@st.fragment
def display_todos():
    st.subheader("📋 Your Todos")
    
    todos = get_todos()
    
    if not todos:
        st.info("🎉 No todos yet! Add one above to get started.")
    else:
        for todo_id, task, completed, created_at in todos:
            col1, col2, col3 = st.columns([0.1, 0.7, 0.2])
            
            with col1:
                if st.checkbox("", value=completed, key=f"check_{todo_id}"):
                    if not completed:
                        toggle_todo(todo_id)
                        st.rerun(scope="fragment")
                elif completed:
                    toggle_todo(todo_id)
                    st.rerun(scope="fragment")
            
            with col2:
                st.markdown(f"~~{task}~~ ✅" if completed else task)
                st.caption(f"Created: {created_at.strftime('%Y-%m-%d %H:%M')}")
            
            with col3:
                if st.button("🗑️", key=f"delete_{todo_id}"):
                    delete_todo(todo_id)
                    st.rerun(scope="fragment")


# Streamlit UI
def main():
    st.set_page_config(
        page_title="Todo List App",
        page_icon="✅",
        layout="wide"
    )
    
    st.title("📝 Todo List App")
    st.markdown("---")
    
    # Initialize database
    if not init_database():
        st.stop()
    
    # Add new todo section
    st.subheader("➕ Add New Todo")
    with st.form("add_todo_form", clear_on_submit=True):
        new_task = st.text_input("Enter a new task:", placeholder="What do you need to do?")
        submitted = st.form_submit_button("Add Todo", type="primary")
        
        if submitted and new_task.strip():
            if add_todo(new_task.strip()):
                st.success("✅ Todo added successfully!")
    
    st.markdown("---")
    
    display_todos()

if __name__ == "__main__":
    main() 