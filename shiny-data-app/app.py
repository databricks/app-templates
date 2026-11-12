# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import asyncio
import re
from shiny import App, ui, render, reactive, run_app
from databricks.sdk import config
from databricks import sql
import os

from security import SecurityMiddleware

# Defined in `app.yaml`
SQL_WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID")
assert SQL_WAREHOUSE_ID, "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

_INITIAL_QUERY = """
SELECT
  *
FROM
  samples.nyctaxi.trips
"""

MAX_QUERY_CHARS = 10000
_SQL_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)
_READ_ONLY_START = re.compile(r"(select|with)\b", re.IGNORECASE)
# A WITH clause can also prefix INSERT, UPDATE, DELETE or MERGE.
_WRITE_KEYWORDS = re.compile(r"\b(insert|update|delete|merge)\b", re.IGNORECASE)


def validate_query(statement):
    """
    Returns an error message unless `statement` is a single read-only SELECT/WITH query.

    Queries run as the app's service principal, so this keeps the playground
    read-only. It is a guard, not a SQL parser: the service principal's Unity
    Catalog grants remain the real limit on what can be read.
    """
    if len(statement) > MAX_QUERY_CHARS:
        return f"Queries are limited to {MAX_QUERY_CHARS} characters."
    # Semicolons and write keywords are checked on the raw text, so a string
    # literal such as '--' can't hide a second statement from the check.
    if ";" in statement.strip().rstrip(";"):
        return "Only a single statement can be run."
    body = _SQL_COMMENTS.sub(" ", statement).strip()
    if not _READ_ONLY_START.match(body) or _WRITE_KEYWORDS.search(statement):
        return "Only read-only queries starting with SELECT or WITH can be run."
    return None


def execute_query(connection, statement, max_rows=10000):
    """
    Executes an SQL statement and fetches up to `max_rows` results.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(statement)
            res = (
                cursor.fetchmany_arrow(max_rows)
                if max_rows
                else cursor.fetchall_arrow()
            )
        return res
    except Exception as e:
        print(f"Error executing query: {e}")
        return e


app_ui = ui.page_navbar(
    ui.nav_panel(
        "Query",
        # text input formatted to use monospace font
        ui.tags.head(ui.tags.style("#sql_query {font-family: monospace;}")),
        ui.p(
            "Queries run with the app's service principal identity, not your own permissions, "
            "so you can read any data the app can read. Only a single read-only SELECT or WITH "
            "query is allowed, a maximum of 10k rows will be returned and a timeout of 60s is set."
        ),
        ui.input_text_area(
            "sql_query", label="", rows=6, value=_INITIAL_QUERY, width="100%"
        ),
        ui.span(
            ui.input_task_button(
                "submit_query", label="Run Query", width="79%", class_="btn-primary"
            ),
            ui.input_action_button(
                "cancel_query",
                label="Cancel Query",
                width="20%",
                class_="btn-warning",
                disabled=True,
            ),
            class_="inline",
        ),
        ui.hr(),
        ui.output_data_frame("query_results"),
    ),
    title="Data Playground",
)


def server(input, output, session):
    # Authenticate as the app's service principal
    cfg = config.Config()

    # Define the extended task to execute the query asynchronously
    @ui.bind_task_button(button_id="submit_query")
    @reactive.extended_task
    async def run_query_task(query: str):
        try:
            # Connect to SQL warehouse inside the task to ensure thread safety
            connection = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{SQL_WAREHOUSE_ID}",
                credentials_provider=lambda: cfg.authenticate,
                session_configuration={"STATEMENT_TIMEOUT": "60"},
            )
            res = await asyncio.to_thread(execute_query, connection, query)
            ui.update_action_button("cancel_query", disabled=True)
            return res
        except Exception as e:
            return e

    # Start the task when the 'Run Query' button is pressed
    @reactive.effect
    @reactive.event(input.submit_query)
    def handle_query():
        ui.update_action_button("cancel_query", disabled=False)
        # Don't attempt execution for empty queries
        query = input.sql_query()
        if not query.strip():
            ui.notification_show("Please enter a SQL query.", type="warning")
            return
        error = validate_query(query)
        if error:
            ui.update_action_button("cancel_query", disabled=True)
            ui.notification_show(error, type="warning")
            return
        run_query_task(query)

    # Handle the 'Cancel Query' button
    @reactive.effect
    @reactive.event(input.cancel_query)
    def handle_cancel():
        ui.update_action_button("cancel_query", disabled=True)
        ui.notification_show("Cancelling query", type="info")
        run_query_task.cancel()

    # Display the query results
    @render.data_frame
    def query_results():
        res = run_query_task.result()
        if isinstance(res, Exception):
            ui.notification_show(
                f"Error executing query: {res}", type="error", duration=12
            )
            return None
        elif res:
            return render.DataGrid(
                res.to_pandas(), height="700px", width="100%", filters=True
            )
        else:
            return None


app = SecurityMiddleware(App(app_ui, server))

if __name__ == "__main__":
    run_app("app:app")
