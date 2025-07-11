import os
from databricks import sql
from databricks.sdk.core import Config
import streamlit as st
import pandas as pd

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

# Databricks config
cfg = Config()

# Query the SQL warehouse with Service Principal credentials
def sql_query_with_service_principal(query: str) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame."""
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        credentials_provider=lambda: cfg.authenticate  # Uses SP credentials from the environment variables
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

# Query the SQL warehouse with the user credentials
def sql_query_with_user_token(query: str, user_token: str) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame."""
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        access_token=user_token  # Pass the user token into the SQL connect to query on behalf of user
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

st.set_page_config(layout="wide")

st.header("Taxi fare distribution !!! :)")
col1, col2 = st.columns([3, 1])
# Extract user access token from the request headers
user_token = st.context.headers.get('X-Forwarded-Access-Token')
# Query the SQL data with the user credentials
data = sql_query_with_user_token("SELECT * FROM samples.nyctaxi.trips LIMIT 5000", user_token=user_token)
# In order to query with Service Principal credentials, comment the above line and uncomment the below line
# data = sql_query_with_service_principal("SELECT * FROM samples.nyctaxi.trips LIMIT 5000")
with col1:
    st.scatter_chart(data=data, height=400, width=700, y="fare_amount", x="trip_distance")
with col2:
    st.subheader("Predict fare")
    pickup = st.text_input("From (zipcode)", value="10003")
    dropoff = st.text_input("To (zipcode)", value="11238")
    d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
    st.write(f"# **${d['fare_amount'].mean() if len(d) > 0 else 99:.2f}**")

st.dataframe(data=data, height=600, use_container_width=True)
