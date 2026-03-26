from pathlib import Path

from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

from agent_server.a2a_wrapper import add_a2a_endpoints, create_agent_card

# Load env vars from .env before importing the agent for proper auth
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402

agent_server = AgentServer("ResponsesAgent", enable_chat_proxy=True)
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()

# After app is created:
card = create_agent_card(
    name="MultiAgentOrchestrator",
    description="Routes queries to chart, knowledge, and custom agents",
    skills=[{"id": "route", "name": "Route Query", "description": "Route to specialist"}],
    url="http://localhost:8000",
)
add_a2a_endpoints(app, card)

def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
