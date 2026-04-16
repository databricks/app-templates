import streamlit as st
import psycopg
import os
from databricks import sdk
from psycopg import sql
from psycopg_pool import ConnectionPool

# Database connection setup
workspace_client = sdk.WorkspaceClient()
endpoint = os.getenv("PGENDPOINT", "")
connection_pool = None


class OAuthConnection(psycopg.Connection):
    """Connection subclass that auto-refreshes OAuth credentials."""

    @classmethod
    def connect(cls, conninfo="", **kwargs):
        credential = workspace_client.postgres.generate_database_credential(
            endpoint=endpoint
        )
        kwargs["password"] = credential.token
        return super().connect(conninfo, **kwargs)


def get_connection_pool():
    """Get or create the connection pool."""
    global connection_pool
    if connection_pool is None:
        conn_string = (
            f"dbname={os.getenv('PGDATABASE')} "
            f"user={os.getenv('PGUSER')} "
            f"host={os.getenv('PGHOST')} "
            f"port={os.getenv('PGPORT')} "
            f"sslmode={os.getenv('PGSSLMODE', 'require')} "
            f"application_name={os.getenv('PGAPPNAME')}"
        )
        connection_pool = ConnectionPool(
            conn_string, connection_class=OAuthConnection, min_size=2, max_size=10
        )
    return connection_pool


def get_connection():
    """Get a connection from the pool."""
    return get_connection_pool().connection()


def get_schema_name():
    """Get the schema name in the format {PGAPPNAME}_schema_{PGUSER}."""
    pgappname = os.getenv("PGAPPNAME", "my_app")
    pguser = os.getenv("PGUSER", "").replace('-', '')
    return f"{pgappname}_schema_{pguser}"


def init_database():
    """Initialize database schema and table."""
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


def add_todo(task):
    with get_connection() as conn:
        with conn.cursor() as cur:
            schema = get_schema_name()
            cur.execute(sql.SQL("INSERT INTO {}.todos (task) VALUES (%s)").format(sql.Identifier(schema)), (task.strip(),))
            conn.commit()


def get_todos():
    with get_connection() as conn:
        with conn.cursor() as cur:
            schema = get_schema_name()
            cur.execute(sql.SQL("SELECT id, task, completed, created_at FROM {}.todos ORDER BY created_at DESC").format(sql.Identifier(schema)))
            return cur.fetchall()


def toggle_todo(todo_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            schema = get_schema_name()
            cur.execute(sql.SQL("UPDATE {}.todos SET completed = NOT completed WHERE id = %s").format(sql.Identifier(schema)), (todo_id,))
            conn.commit()


def delete_todo(todo_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            schema = get_schema_name()
            cur.execute(sql.SQL("DELETE FROM {}.todos WHERE id = %s").format(sql.Identifier(schema)), (todo_id,))
            conn.commit()

@st.fragment
def display_todos():
    st.subheader("Your Todos")

    todos = get_todos()

    if not todos:
        st.info("No todos yet! Add one above to get started.")
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
                st.markdown(f"~~{task}~~" if completed else task)
                st.caption(f"Created: {created_at.strftime('%Y-%m-%d %H:%M')}")

            with col3:
                if st.button("Delete", key=f"delete_{todo_id}"):
                    delete_todo(todo_id)
                    st.rerun(scope="fragment")


# Streamlit UI
def main():
    st.set_page_config(
        page_title="Todo List App",
        layout="wide"
    )

    st.title("Todo List App")
    st.markdown("---")

    # Initialize database
    if not init_database():
        st.stop()

    # Add new todo section
    st.subheader("Add New Todo")
    with st.form("add_todo_form", clear_on_submit=True):
        new_task = st.text_input("Enter a new task:", placeholder="What do you need to do?")
        submitted = st.form_submit_button("Add Todo", type="primary")

        if submitted and new_task.strip():
            if add_todo(new_task.strip()):
                st.success("Todo added successfully!")

    st.markdown("---")

    display_todos()

if __name__ == "__main__":
    main()
