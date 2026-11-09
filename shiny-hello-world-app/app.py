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
from shiny.express import ui, input, render

with ui.sidebar():
  ui.tags.h1("Hello World!")
  ui.input_slider("n", "Number of bins", 0, 100, 20)

@render.plot(alt="A histogram")
def histogram():
  np.random.seed(12345)
  x = 100 + 15 * np.random.randn(500)
  plt.hist(x, input.n(), density=True)
