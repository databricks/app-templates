# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import os

import gradio as gr
import pandas as pd
import uvicorn
from fastapi import FastAPI
from starlette.middleware import Middleware

from security import SecurityMiddleware

data = pd.DataFrame({'x': [x for x in range(30)],
                     'y': [2 ** x for x in range(30)]})

# Display the data with Gradio
with gr.Blocks() as gradio_app:
    with gr.Row():
        with gr.Column(scale=3):
            gr.Markdown('# Hello world!')
            gr.ScatterPlot(value=data, height=400,
                           container=False, x='x', y='y',
                           y_title='Fun with data', x_title='Apps')

if __name__ == '__main__':
    # Gradio adds its own CORS middleware outside any launch(app_kwargs=...)
    # middleware, so SecurityMiddleware goes on a parent app that wraps it.
    app = gr.mount_gradio_app(
        FastAPI(middleware=[Middleware(SecurityMiddleware)]),
        gradio_app,
        path='/',
        css='footer {visibility: hidden}',
    )
    uvicorn.run(
        app,
        host=os.getenv('GRADIO_SERVER_NAME', '127.0.0.1'),
        port=int(os.getenv('GRADIO_SERVER_PORT', '7860')),
    )
