import os
from databricks import sql
from databricks.sdk.core import Config
import gradio as gr
import pandas as pd
import uvicorn
from fastapi import FastAPI
from starlette.middleware import Middleware

from security import SecurityMiddleware

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

# Databricks config
cfg = Config()

# This example query depends on the nyctaxi data set in Unity Catalog, see https://docs.databricks.com/en/discover/databricks-datasets.html for details
QUERY = "SELECT * FROM samples.nyctaxi.trips LIMIT 5000"

# Query the SQL data with Service Principal credentials
def sql_query_with_service_principal(query: str, params: dict | None = None) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame.

    Pass user values in `params` and reference them as :name markers in the query.
    """
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        credentials_provider=lambda: cfg.authenticate  # Uses SP credentials from the environment variables
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall_arrow().to_pandas()

# Query the SQL data with the user credentials
def sql_query_with_user_token(query: str, user_token: str, params: dict | None = None) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame.

    Pass user values in `params` and reference them as :name markers in the query.
    """
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        access_token=user_token  # Pass the user token into the SQL connect to query on behalf of user
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall_arrow().to_pandas()

with gr.Blocks() as demo:
    # Display only: the server always runs QUERY, never the contents of this box.
    gr.Textbox(value=QUERY, label="SQL Query", interactive=False)
    btn = gr.Button("Run Query")

    @gr.render(triggers=[btn.click])
    def load_everything(request: gr.Request):
        # Read the user token from the request on every run; never send it to the browser.
        user_token = request.headers.get("x-forwarded-access-token")
        if not user_token:
            gr.Markdown("No user token found. Open this app through its Databricks Apps URL to run the query as yourself.")
            return

        # Query the SQL data with the user credentials
        data = sql_query_with_user_token(QUERY, user_token=user_token)
        # In order to query with Service Principal credentials, comment the above line and uncomment the below line
        # data = sql_query_with_service_principal(QUERY)

        with gr.Row():
            with gr.Column(scale=3):
                gr.Markdown("# Taxi fare distribution")
                gr.ScatterPlot(value=data, height=400, container=False,
                            y="fare_amount", x="trip_distance", y_title="Fare", x_title="Distance")

        gr.Dataframe(value=data)

# Gradio adds its own CORS middleware outside any launch(app_kwargs=...)
# middleware, so SecurityMiddleware goes on a parent app that wraps it.
app = gr.mount_gradio_app(
    FastAPI(middleware=[Middleware(SecurityMiddleware)]), demo, path="/"
)
uvicorn.run(
    app,
    host=os.getenv("GRADIO_SERVER_NAME", "127.0.0.1"),
    port=int(os.getenv("GRADIO_SERVER_PORT", "7860")),
)
