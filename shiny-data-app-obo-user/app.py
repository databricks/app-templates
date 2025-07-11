import asyncio
from shiny import App, ui, render, reactive
from databricks.sdk import config
from databricks import sql
import os

# Defined in `app.yaml`
assert os.getenv("DATABRICKS_WAREHOUSE_ID"), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

_INITIAL_QUERY = """
SELECT
  *
FROM
  samples.nyctaxi.trips
"""


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
            "Queries are run with your permissions, a maximum of 10k rows will be returned. "
            "A timeout of 60s is set."
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

# Databricks configuration
cfg = config.Config()

def server(input, output, session):
    # Define the extended task to execute the query asynchronously
    @ui.bind_task_button(button_id="submit_query")
    @reactive.extended_task
    async def run_query_task(query: str):
        try:
            # Get the user access token from the session request header
            user_token = session.http_conn.headers.get('X-Forwarded-Access-Token', None)
            # Create a connection with the user's access token
            connection_with_user_creds = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
                access_token=user_token,
            )
            # Create a connection with the service principal credentials
            connection_with_service_principal_creds = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
                credentials_provider=lambda: cfg.authenticate  # Uses SP credentials from the environment variables
            )

            # Query the SQL data with the user credentials
            res = await asyncio.to_thread(execute_query, connection_with_user_creds, query)
            # In order to query with Service Principal credentials, comment the above line and uncomment the below line
            # res = await asyncio.to_thread(execute_query, connection_with_service_principal_creds, query)
            ui.update_action_button("cancel_query", disabled=True)
            return res
        except Exception as e:
            print(f"Error executing query: {e}")
            return e

    # Start the task when the 'Run Query' button is pressed
    @reactive.effect
    @reactive.event(input.submit_query)
    def handle_query():
        ui.update_action_button("cancel_query", disabled=False)
        # Don't attempt execution for empty queries
        if not input.sql_query().strip():
            ui.notification_show("Please enter a SQL query.", type="warning")
            return
        run_query_task(input.sql_query())

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


app = App(app_ui, server)

if __name__ == "__main__":
    app.run()