from pathlib import Path

from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

from agent_server.a2a_wrapper import add_a2a_endpoints, build_agent_card

# Load env vars from .env before importing the agent for proper auth
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402

agent_server = AgentServer("ResponsesAgent", enable_chat_proxy=True)
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()

# Register A2A protocol endpoints (HTTP+JSON/REST binding v1.0)
# This exposes /.well-known/agent-card.json, /a2a/message:send, etc.
add_a2a_endpoints(app, build_agent_card())

def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
