import os
from databricks import sql
from databricks.sdk.core import Config
import streamlit as st
import pandas as pd
import numpy as np

st.set_page_config(layout="wide")

# def sqlQuery(query: str) -> pd.DataFrame:
#     # ensure the right environment variables are set
#     def defined(var: str) -> bool: return os.getenv(var) is not None
#     assert defined('DATABRICKS_WAREHOUSE_ID') and os.getenv('DATABRICKS_WAREHOUSE_ID') != "<your warehouse ID>", "To use SQL, set DATABRICKS_WAREHOUSE_ID in app.yaml. You can find your SQL Warehouse ID by navigating to SQL Warehouses, clicking on your warehouse, and then looking for the ID next to the Name."
#     assert defined('DATABRICKS_HOST'), "To run outside of Lakehouse Apps, set the DATABRICKS_HOST environment variable to the name of your Databricks account."
#     assert defined('DATABRICKS_TOKEN') or (defined('DATABRICKS_CLIENT_ID') and defined('DATABRICKS_CLIENT_SECRET')), "To run outside of Lakehouse Apps, set environment variables for authentication, such as DATABRICKS_TOKEN or DATABRICKS_CLIENT_ID/DATABRICKS_CLIENT_SECRET."
    
#     cfg = Config() # Pull environment variables for auth
#     with sql.connect(server_hostname=os.getenv("DATABRICKS_HOST"),
#                      http_path=f"""/sql/1.0/warehouses/{os.getenv("DATABRICKS_WAREHOUSE_ID")}""",
#                      credentials_provider=lambda: cfg.authenticate) as connection:
#         with connection.cursor() as cursor:
#             cursor.execute(query)
#             return cursor.fetchall_arrow().to_pandas()

# @st.cache_data(ttl=30)  # only re-query if it's been 30 seconds
# def getData():
#     return sqlQuery("select * from samples.nyctaxi.trips limit 5000")

# data = getData()

st.header("Hello world!!!")
apps = st.slider("Number of apps", max_value=60, value=10)
chart_data = pd.DataFrame({'y':[2 ** x for x in range(apps)]})
st.bar_chart(chart_data, height=500, width=min(100+50*apps, 1000), 
             use_container_width=False, x_label="Apps", y_label="Fun with data")

