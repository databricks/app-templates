import streamlit as st
from starlette.middleware import Middleware

from security import SecurityMiddleware

app = st.App("app.py", middleware=[Middleware(SecurityMiddleware)])
