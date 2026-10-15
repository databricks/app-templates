# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import gradio as gr
import pandas as pd

data = pd.DataFrame({'x': [x for x in range(30)],
                     'y': [2 ** x for x in range(30)]})

# Display the data with Gradio
with gr.Blocks(css='footer {visibility: hidden}') as gradio_app:
    with gr.Row():
        with gr.Column(scale=3):
            gr.Markdown('# Hello world!')
            gr.ScatterPlot(value=data, height=400, width=700,
                           container=False, x='x', y='y',
                           y_title='Fun with data', x_title='Apps')

if __name__ == '__main__':
    gradio_app.launch()
