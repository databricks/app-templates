import os
import re
from databricks import sql
import pandas as pd
import dash
from dash import dcc, html, Input, Output, State
import plotly.express as px
import dash_bootstrap_components as dbc
import dash_ag_grid as dag
from databricks.sdk.core import Config
import flask  # for request context

import security

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

# Databricks config
cfg = Config()

# Query the SQL warehouse with Service Principal credentials
def sql_query_with_service_principal(query: str, params: dict | None = None) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame.

    Pass user-supplied values through ``params`` with named markers, e.g.
    ``"SELECT * FROM t WHERE pickup_zip = :zip"`` with ``{"zip": 10003}``.
    """
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        credentials_provider=lambda: cfg.authenticate  # Uses SP credentials from the environment variables
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall_arrow().to_pandas()

# Query the SQL warehouse with the user credentials
def sql_query_with_user_token(query: str, user_token: str, params: dict | None = None) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame.

    Pass user-supplied values through ``params`` with named markers, e.g.
    ``"SELECT * FROM t WHERE pickup_zip = :zip"`` with ``{"zip": 10003}``.
    """
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{cfg.warehouse_id}",
        access_token=user_token  # Pass the user token into the SQL connect to query on behalf of user
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall_arrow().to_pandas()

def load_data() -> pd.DataFrame:
    try:
        # Extract user access token from the request headers
        user_token = flask.request.headers.get('X-Forwarded-Access-Token')
        if not user_token:
            raise Exception("Missing access token in headers.")
        # Query the SQL data with the user credentials
        return sql_query_with_user_token("SELECT * FROM samples.nyctaxi.trips LIMIT 5000", user_token=user_token)
        # In order to query with Service Principal credentials, comment the above line and uncomment the below line
        # return sql_query_with_service_principal("SELECT * FROM samples.nyctaxi.trips LIMIT 5000")
    except Exception as e:
        print(f"Data load failed: {str(e)}")
        return pd.DataFrame()

def parse_zipcode(value):
    """Return the zipcode as an int, or None if it isn't exactly five digits."""
    if isinstance(value, str) and re.fullmatch(r"\d{5}", value.strip()):
        return int(value)
    return None

def calculate_fare_prediction(data, pickup_zip, dropoff_zip):
    """Calculate the predicted fare based on pickup and dropoff zipcodes."""
    d = data[(data['pickup_zip'] == pickup_zip) & (data['dropoff_zip'] == dropoff_zip)]
    fare_prediction = d['fare_amount'].mean() if len(d) > 0 else 99
    return f"Predicted Fare: ${fare_prediction:.2f}"

# Initialize the Dash app with Bootstrap styling
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

# Layout (without using global `data`)
app.layout = dbc.Container([
    dcc.Store(id='page-load-trigger', data=0),
    dbc.Row([dbc.Col(html.H1("Taxi Fare Distribution"), width=12)]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='fare-scatter', style={'height': '400px', 'width': '100%'})
        ], width=8),
        dbc.Col([
            html.H3("Predict Fare"),
            dbc.Label("From (zipcode)"),
            dbc.Input(id='from-zipcode', type='text', value='10003', maxLength=5),
            dbc.Label("To (zipcode)"),
            dbc.Input(id='to-zipcode', type='text', value='11238', maxLength=5),
            dbc.Button("Predict", id='submit-button', n_clicks=0, color='primary', className='mt-3'),
            html.Div(id='prediction-output', className='mt-3', style={'font-size': '24px', 'font-weight': 'bold'})
        ], width=4)
    ]),
    dbc.Row([
        dbc.Col([
            dag.AgGrid(id='data-grid')
        ], width=12)
    ])
], fluid=True)

# Callback to load data and populate graph + grid
@app.callback(
    Output('fare-scatter', 'figure'),
    Output('data-grid', 'rowData'),
    Output('data-grid', 'columnDefs'),
    Input('page-load-trigger', 'data')
)
def update_visuals(n_clicks):
    data = load_data()
    fig = px.scatter(
        data,
        x='trip_distance',
        y='fare_amount',
        labels={'fare_amount': 'Fare', 'trip_distance': 'Distance'}
    )
    return (
        fig,
        data.to_dict('records'),
        [{"headerName": col, "field": col} for col in data.columns]
    )

@app.callback(
    Output('prediction-output', 'children'),
    Input('submit-button', 'n_clicks'),
    State('from-zipcode', 'value'),
    State('to-zipcode', 'value')
)
def render_prediction(n_clicks, pickup, dropoff):
    pickup_zip, dropoff_zip = parse_zipcode(pickup), parse_zipcode(dropoff)
    if pickup_zip is None or dropoff_zip is None:
        return "Please enter 5-digit zipcodes."
    data = load_data()
    return calculate_fare_prediction(data, pickup_zip, dropoff_zip)

security.init_app(app.server, extra_script_sources=app.csp_hashes())

if __name__ == "__main__":
    # Debug mode is off by default; set DASH_DEBUG=true to enable it for local development.
    app.run()