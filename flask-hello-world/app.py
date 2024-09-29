import os
from databricks import sql
import pandas as pd
from databricks.sdk.core import Config
from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello_world():
    chart_data = pd.DataFrame({'Apps': [x for x in range(30)], 'Fun with data': [2 ** x for x in range(30)]})
    return f"<h1>Hello, World!</h1> {chart_data.to_html(index=False)}"

if __name__ == "__main__":
    app.run_server(debug=True)