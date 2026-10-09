# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import streamlit as st
import pandas as pd

st.set_page_config(layout="wide")

st.header("Hello world!!!")
apps = st.slider("Number of apps", max_value=60, value=10)
chart_data = pd.DataFrame({'y':[2 ** x for x in range(apps)]})
st.bar_chart(chart_data, height=500, width=min(100+50*apps, 1000), 
             use_container_width=False, x_label="Apps", y_label="Fun with data")
