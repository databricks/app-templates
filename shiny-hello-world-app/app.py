# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import matplotlib.pyplot as plt
import numpy as np
from shiny import App, render, ui

from security import SecurityMiddleware

MIN_BINS, MAX_BINS = 1, 100

app_ui = ui.page_sidebar(
  ui.sidebar(
    ui.tags.h1("Hello World!"),
    ui.input_slider("n", "Number of bins", MIN_BINS, MAX_BINS, 20),
  ),
  ui.output_plot("histogram"),
)


def server(input, output, session):
  @render.plot(alt="A histogram")
  def histogram():
    # The slider range is only enforced in the browser; clamp it here too.
    bins = min(max(int(input.n()), MIN_BINS), MAX_BINS)
    np.random.seed(12345)
    x = 100 + 15 * np.random.randn(500)
    plt.hist(x, bins, density=True)


app = SecurityMiddleware(App(app_ui, server))
