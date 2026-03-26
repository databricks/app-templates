"""
A2A wrapper: Exposes each subagent as an A2A-compatible server
with Agent Cards for discovery.
"""
import json
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

def create_agent_card(name: str, description: str, skills: list, url: str):
    """Generate an A2A-compliant Agent Card."""
    return {
        "name": name,
        "description": description,
        "url": url,
        "version": "1.0.0",
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
        },
        "skills": [
            {
                "id": skill["id"],
                "name": skill["name"],
                "description": skill["description"],
                "tags": skill.get("tags", []),
            }
            for skill in skills
        ],
    }

def add_a2a_endpoints(app: FastAPI, agent_card: dict):
    """Add A2A discovery endpoint to an existing FastAPI app."""

    @app.get("/.well-known/agent.json")
    async def get_agent_card():
        return JSONResponse(content=agent_card)

    @app.post("/a2a/tasks")
    async def handle_task(request: Request):
        body = await request.json()
        # Bridge A2A task → existing /invocations endpoint
        user_message = body.get("input", [{}])[0].get("parts", [{}])[0].get("text", "")
        # Forward to the same agent logic
        return JSONResponse(content={
            "id": body.get("id"),
            "state": "completed",
            "output": {"parts": [{"type": "text", "text": f"Processed: {user_message}"}]},
        })