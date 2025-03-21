import os
from databricks import sql
import pandas as pd
import dash
from dash import dcc, html, Input, Output, State
import plotly.express as px
import dash_bootstrap_components as dbc
import dash_ag_grid as dag
from databricks.sdk.core import Config
import flask  # for request context

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

def sqlQuery(query: str, user_token: str) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame."""
    cfg = Config()  # Pull environment variables for auth
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{os.getenv('DATABRICKS_WAREHOUSE_ID')}",
        access_token=user_token
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

def load_data() -> pd.DataFrame:
    try:

        user_token = flask.request.headers.get('X-Forwarded-Access-Token')
        if not user_token:
            raise Exception("Missing access token in headers.")
        return sqlQuery("SELECT * FROM samples.nyctaxi.trips LIMIT 5000", user_token=user_token)
    except Exception as e:
        print(f"Data load failed: {str(e)}")
        return pd.DataFrame()

def calculate_fare_prediction(data, pickup, dropoff):
    """Calculate the predicted fare based on pickup and dropoff zipcodes."""
    d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
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
            dbc.Input(id='from-zipcode', type='text', value='10003'),
            dbc.Label("To (zipcode)"),
            dbc.Input(id='to-zipcode', type='text', value='11238'),
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
    data = load_data()
    return calculate_fare_prediction(data, pickup, dropoff)

if __name__ == "__main__":
    app.run_server(debug=True)