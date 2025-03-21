import os
from databricks import sql
from databricks.sdk.core import Config
import streamlit as st
import pandas as pd

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

def sqlQuery(query: str) -> pd.DataFrame:
    cfg = Config()
    # auth on-behalf-of user
    user_token = st.context.headers.get('X-Forwarded-Access-Token')
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{os.getenv('DATABRICKS_WAREHOUSE_ID')}",
        access_token=user_token
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

st.set_page_config(layout="wide")

st.header("Taxi fare distribution !!! :)")
col1, col2 = st.columns([3, 1])
with col1:
    st.scatter_chart(data=data, height=400, width=700, y="fare_amount", x="trip_distance")
with col2:
    st.subheader("Predict fare")
    data = sqlQuery()
    pickup = st.text_input("From (zipcode)", value="10003")
    dropoff = st.text_input("To (zipcode)", value="11238")
    d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
    st.write(f"# **${d['fare_amount'].mean() if len(d) > 0 else 99:.2f}**")

st.dataframe(data=data, height=600, use_container_width=True)
