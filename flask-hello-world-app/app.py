import pandas as pd
from flask import Flask
import logging
import os

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)

@app.route('/')
def hello_world():
    chart_data = pd.DataFrame({'Apps': [x for x in range(30)],
                               'Fun with data': [2 ** x for x in range(30)]})
    return f'<h1>Hello, World!</h1> {chart_data.to_html(index=False)}'

if __name__ == '__main__':
    host = os.getenv('FLASK_RUN_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_RUN_PORT', 8000))

    app.run(debug=True, host=host, port=port)
    print(f"Flask app running on http://{host}:{port}")

