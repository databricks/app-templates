#!/usr/bin/env bash
echo 123

uvicorn agent_server.app:app --host 0.0.0.0 --port 8000 &
# npm run start --prefix e2e-chatbot-app-next &

cd e2e-chatbot-app-next && npm install && npm run start
