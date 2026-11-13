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
import os

from databricks.sdk import config
from databricks import sql
from shiny import App, ui, render, reactive, run_app

from security import SecurityMiddleware

# Defined in `app.yaml`
SQL_WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID")
assert SQL_WAREHOUSE_ID, "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

_INITIAL_TABLE = "samples.nyctaxi.trips"
_QUERY = "SELECT * FROM IDENTIFIER(:table_name) LIMIT :row_limit"
MAX_ROWS = 10000


def execute_query(connection, table_name, row_limit):
    """
    Reads up to `row_limit` rows from `table_name`.

    The table name is bound with IDENTIFIER(:table_name) and the limit with a
    :row_limit parameter marker, so neither value becomes SQL text.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                _QUERY, {"table_name": table_name, "row_limit": row_limit}
            )
            return cursor.fetchmany_arrow(row_limit)
    except Exception as e:
        print(f"Error executing query: {e}")
        return e


app_ui = ui.page_navbar(
    ui.nav_panel(
        "Query",
        ui.tags.head(ui.tags.style("#table_name {font-family: monospace;}")),
        ui.p(
            "Rows are read with the app's service principal identity, not your own permissions, "
            "so you can read any table the app can read. Enter a table name such as "
            f"catalog.schema.table; a maximum of {MAX_ROWS // 1000}k rows will be returned "
            "and a timeout of 60s is set."
        ),
        ui.input_text("table_name", label="Table", value=_INITIAL_TABLE, width="100%"),
        ui.input_numeric(
            "row_limit", label="Rows", value=1000, min=1, max=MAX_ROWS, width="200px"
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
    async def run_query_task(table_name: str, row_limit: int):
        try:
            # Connect to SQL warehouse inside the task to ensure thread safety
            connection = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{SQL_WAREHOUSE_ID}",
                credentials_provider=lambda: cfg.authenticate,
                session_configuration={"STATEMENT_TIMEOUT": "60"},
            )
            res = await asyncio.to_thread(
                execute_query, connection, table_name, row_limit
            )
            ui.update_action_button("cancel_query", disabled=True)
            return res
        except Exception as e:
            return e

    # Start the task when the 'Run Query' button is pressed
    @reactive.effect
    @reactive.event(input.submit_query)
    def handle_query():
        table_name = (input.table_name() or "").strip()
        if not table_name:
            ui.notification_show("Please enter a table name.", type="warning")
            return
        requested_rows = input.row_limit()
        if requested_rows is None:
            ui.notification_show("Please enter a number of rows.", type="warning")
            return
        row_limit = max(1, min(int(requested_rows), MAX_ROWS))
        ui.update_action_button("cancel_query", disabled=False)
        run_query_task(table_name, row_limit)

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
