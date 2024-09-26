import os
from databricks import sql
import pandas as pd
import dash
from dash import dcc, html, Input, Output, State
import plotly.express as px
import dash_bootstrap_components as dbc
import dash_ag_grid as dag
from databricks.sdk.core import Config

# Ensure environment variable is set correctly
assert os.getenv('DATABRICKS_WAREHOUSE_ID'), "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

def sqlQuery(query: str) -> pd.DataFrame:
    """Execute a SQL query and return the result as a pandas DataFrame."""
    cfg = Config()  # Pull environment variables for auth
    with sql.connect(
        server_hostname=cfg.host,
        http_path=f"/sql/1.0/warehouses/{os.getenv('DATABRICKS_WAREHOUSE_ID')}",
        credentials_provider=lambda: cfg.authenticate
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

# Fetch the data
try:
    # This example query depends on the nyctaxi data set in Unity Catalog, see https://docs.databricks.com/en/discover/databricks-datasets.html for details
    data = sqlQuery("SELECT * FROM samples.nyctaxi.trips LIMIT 5000")
    print(f"Data shape: {data.shape}")
    print(f"Data columns: {data.columns}")
except Exception as e:
    print(f"An error occurred in querying data: {str(e)}")
    data = pd.DataFrame()

def calculate_fare_prediction(pickup, dropoff):
    """Calculate the predicted fare based on pickup and dropoff zipcodes."""
    d = data[(data['pickup_zip'] == int(pickup)) & (data['dropoff_zip'] == int(dropoff))]
    fare_prediction = d['fare_amount'].mean() if len(d) > 0 else 99
    return f"Predicted Fare: ${fare_prediction:.2f}"

# Initialize the Dash app with Bootstrap styling
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

# Define the app layout
app.layout = dbc.Container([
    dbc.Row([dbc.Col(html.H1("Taxi Fare Distribution"), width=12)]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(
                id='fare-scatter',
                figure=px.scatter(
                    data,
                    x='trip_distance',
                    y='fare_amount',
                    labels={'fare_amount': 'Fare', 'trip_distance': 'Distance'}
                ),
                style={'height': '400px', 'width': '100%'}
            )
        ], width=8),
        dbc.Col([
            html.H3("Predict Fare"),
            dbc.Label("From (zipcode)"),
            dbc.Input(id='from-zipcode', type='text', value='10003'),
            dbc.Label("To (zipcode)"),
            dbc.Input(id='to-zipcode', type='text', value='11238'),
            dbc.Button("Predict", id='submit-button', n_clicks=0, color='primary', className='mt-3'),
            html.Div(
                id='prediction-output',
                className='mt-3',
                style={'font-size': '24px', 'font-weight': 'bold'}
            )
        ], width=4)
    ]),
    dbc.Row([
        dbc.Col([
            dag.AgGrid(
                id='data-grid',
                columnDefs=[{"headerName": col, "field": col} for col in data.columns],
                rowData=data.to_dict('records'),
                defaultColDef={"sortable": True, "filter": True, "resizable": True},
                style={'height': '400px', 'width': '100%'}
            )
        ], width=12)
    ])
], fluid=True)

@app.callback(
    Output('prediction-output', 'children'),
    Input('submit-button', 'n_clicks'),
    State('from-zipcode', 'value'),
    State('to-zipcode', 'value')
)
def render_prediction(n_clicks, pickup, dropoff):
    return calculate_fare_prediction(pickup, dropoff)

if __name__ == "__main__":
    # Calculate initial prediction
    initial_prediction = calculate_fare_prediction('10003', '11238')

    # Set initial value for prediction-output
    app.layout.children[1].children[1].children[-1].children = initial_prediction

    app.run_server(debug=True)