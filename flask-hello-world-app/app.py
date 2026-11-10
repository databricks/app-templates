# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

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

    # Debug mode is off by default; set FLASK_DEBUG=1 to enable it for local development.
    app.run(host=host, port=port)
    print(f"Flask app running on http://{host}:{port}")

