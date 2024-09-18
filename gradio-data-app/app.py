import os
from databricks import sql
from databricks.sdk.core import Config
import gradio as gr
import pandas as pd

def sqlQuery(query: str) -> pd.DataFrame:
    # ensure the right environment variables are set
    def defined(var: str) -> bool: return os.getenv(var) is not None
    assert defined('DATABRICKS_WAREHOUSE_ID') and os.getenv('DATABRICKS_WAREHOUSE_ID') != "<your warehouse ID>", "To use SQL, set DATABRICKS_WAREHOUSE_ID in app.yaml. You can find your SQL Warehouse ID by navigating to SQL Warehouses, clicking on your warehouse, and then looking for the ID next to the Name."
    assert defined('DATABRICKS_HOST'), "To run outside of Lakehouse Apps, set the DATABRICKS_HOST environment variable to the name of your Databricks account."
    assert defined('DATABRICKS_TOKEN') or (defined('DATABRICKS_CLIENT_ID') and defined('DATABRICKS_CLIENT_SECRET')), "To run outside of Lakehouse Apps, set environment variables for authentication, such as DATABRICKS_TOKEN or DATABRICKS_CLIENT_ID/DATABRICKS_CLIENT_SECRET."
    
    cfg = Config() # Pull environment variables for auth
    with sql.connect(server_hostname=os.getenv("DATABRICKS_HOST"),
                     http_path=f"""/sql/1.0/warehouses/{os.getenv("DATABRICKS_WAREHOUSE_ID")}""",
                     credentials_provider=lambda: cfg.authenticate) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

data = sqlQuery("select * from samples.nyctaxi.trips limit 5000")

# display the data with Gradio
with gr.Blocks(css="footer {visibility: hidden}") as demo:  # must call it demo to get Gradio hot reload
    with gr.Row():
        with gr.Column(scale=3):
            gr.Markdown("# Taxi fare distribution")
            gr.ScatterPlot(value=data, height=400, width=700, container=False,
                        y="fare_amount", x="trip_distance", y_title="Fare", x_title="Distance")
        with gr.Column(variant='panel'):
            gr.Markdown("## Predict fare\nFrom (zipcode)")
            fromZip = gr.Textbox(value='10003', interactive=True, container=False)
            gr.Markdown("To (zipcode)")
            toZip = gr.Textbox(value='11238', interactive=True, container=False)

            @gr.render(inputs=[fromZip, toZip])
            def render_count(pickup, dropoff):
                d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
                gr.Markdown(f"# **${d['fare_amount'].mean() if len(d) > 0 else 99:.2f}**")

    gr.Dataframe(value=data)

if __name__ == "__main__":
    demo.launch()