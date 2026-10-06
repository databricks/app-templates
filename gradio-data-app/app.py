# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import os
from databricks import sql
from databricks.sdk.core import Config
import gradio as gr
import pandas as pd

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

def sqlQuery(query: str) -> pd.DataFrame:
    cfg = Config() # Pull environment variables for auth
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{os.getenv('DATABRICKS_WAREHOUSE_ID')}",
        credentials_provider=lambda: cfg.authenticate
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

# This example query depends on the nyctaxi data set in Unity Catalog, see https://docs.databricks.com/en/discover/databricks-datasets.html for details
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