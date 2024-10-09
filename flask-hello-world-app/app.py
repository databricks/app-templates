import pandas as pd
from flask import Flask
import logging

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

flask_app = Flask(__name__)

@flask_app.route('/')
def hello_world():
    chart_data = pd.DataFrame({'Apps': [x for x in range(30)],
                               'Fun with data': [2 ** x for x in range(30)]})
    return f'<h1>Hello, World!</h1> {chart_data.to_html(index=False)}'

if __name__ == '__main__':
    flask_app.run(debug=True)
