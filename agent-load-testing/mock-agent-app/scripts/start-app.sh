#!/bin/bash
uv run start-server --workers ${UVICORN_WORKERS:-4}
