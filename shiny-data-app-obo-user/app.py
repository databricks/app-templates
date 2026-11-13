import asyncio
from shiny import App, ui, render, reactive, run_app
from databricks.sdk import config
from databricks import sql
import os

from security import SecurityMiddleware

# Defined in `app.yaml`
assert os.getenv("DATABRICKS_WAREHOUSE_ID"), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

_INITIAL_TABLE = "samples.nyctaxi.trips"
_QUERY = "SELECT * FROM IDENTIFIER(:table_name) LIMIT :row_limit"
MAX_ROWS = 10000
STATEMENT_TIMEOUT_SECONDS = "60"


def execute_query(connection, table_name):
    """
    Reads up to `MAX_ROWS` rows from `table_name`.

    The table name is bound with IDENTIFIER(:table_name) and the limit with a
    :row_limit parameter marker, so neither value becomes SQL text.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(_QUERY, {"table_name": table_name, "row_limit": MAX_ROWS})
            return cursor.fetchmany_arrow(MAX_ROWS)
    except Exception as e:
        print(f"Error executing query: {e}")
        return e


app_ui = ui.page_navbar(
    ui.nav_panel(
        "Query",
        ui.tags.head(ui.tags.style("#table_name {font-family: monospace;}")),
        ui.p(
            "Rows are read with your permissions. Enter a table name such as "
            f"catalog.schema.table; a maximum of {MAX_ROWS // 1000}k rows will be returned "
            "and a timeout of 60s is set."
        ),
        ui.input_text("table_name", label="Table", value=_INITIAL_TABLE, width="100%"),
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

# Databricks configuration
cfg = config.Config()

def server(input, output, session):
    # Define the extended task to execute the query asynchronously
    @ui.bind_task_button(button_id="submit_query")
    @reactive.extended_task
    async def run_query_task(table_name: str):
        try:
            # Get the user access token from the session request header
            user_token = session.http_conn.headers.get('X-Forwarded-Access-Token', None)
            # Create a connection with the user's access token
            connection_with_user_creds = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
                access_token=user_token,
                session_configuration={"STATEMENT_TIMEOUT": STATEMENT_TIMEOUT_SECONDS},
            )
            # Create a connection with the service principal credentials
            connection_with_service_principal_creds = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
                credentials_provider=lambda: cfg.authenticate,  # Uses SP credentials from the environment variables
                session_configuration={"STATEMENT_TIMEOUT": STATEMENT_TIMEOUT_SECONDS},
            )

            # Query the SQL data with the user credentials
            res = await asyncio.to_thread(execute_query, connection_with_user_creds, table_name)
            # In order to query with Service Principal credentials, comment the above line and uncomment the below line
            # res = await asyncio.to_thread(execute_query, connection_with_service_principal_creds, table_name)
            ui.update_action_button("cancel_query", disabled=True)
            return res
        except Exception as e:
            print(f"Error executing query: {e}")
            return e

    # Start the task when the 'Run Query' button is pressed
    @reactive.effect
    @reactive.event(input.submit_query)
    def handle_query():
        table_name = (input.table_name() or "").strip()
        if not table_name:
            ui.notification_show("Please enter a table name.", type="warning")
            return
        ui.update_action_button("cancel_query", disabled=False)
        run_query_task(table_name)

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