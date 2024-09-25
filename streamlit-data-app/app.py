import os
from databricks import sql
from databricks.sdk.core import Config
import streamlit as st
import pandas as pd

def sqlQuery(query: str) -> pd.DataFrame:
    # Ensure the right environment variables are set
    def defined(var: str) -> bool:
        return os.getenv(var) is not None

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

st.set_page_config(layout="wide")

@st.cache_data(ttl=30)  # only re-query if it's been 30 seconds
def getData():
    # This example query depends on the nyctaxi data set in Unity Catalog, see https://docs.databricks.com/en/discover/databricks-datasets.html for details
    return sqlQuery("select * from samples.nyctaxi.trips limit 5000")

data = getData()

st.header("Taxi fare distribution !!! :)")
col1, col2 = st.columns([3, 1])
with col1:
    st.scatter_chart(data=data, height=400, width=700, y="fare_amount", x="trip_distance")
with col2:
    st.subheader("Predict fare")
    pickup = st.text_input("From (zipcode)", value="10003")
    dropoff = st.text_input("To (zipcode)", value="11238")
    d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
    st.write(f"# **${d['fare_amount'].mean() if len(d) > 0 else 99:.2f}**")

st.dataframe(data=data, height=600, use_container_width=True)
