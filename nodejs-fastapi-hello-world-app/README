# Node.js + FastAPI Hello World App

A simple hello world template that demonstrates how to build full-stack applications using Node.js (React) frontend with FastAPI backend for Databricks Apps.

## Architecture

```
React Frontend (TypeScript + Vite)
    ↓ API calls
FastAPI Backend (Python)
    ↓ Serves static files + API
Databricks Apps
```

## Setup

1. **Install Python dependencies:**
```bash
pip install -r requirements.txt
```

2. **Install Node.js dependencies:**
```bash
npm install
```

## Development

1. **Start FastAPI backend:**
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

2. **In another terminal, start React dev server:**
```bash
npm run dev
```

- Frontend: http://localhost:5173 (with API proxy)
- Backend API docs: http://localhost:8000/docs

## Production

Build and run:
```bash
npm run build
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Databricks Apps Deployment

Configured for Databricks Apps with `app.yaml`. Uses `DATABRICKS_APP_PORT` environment variable automatically.

## API

- `GET /api/hello` - Hello world message
- `GET /docs` - FastAPI interactive documentation