# Install crash/hang/exception diagnostics before importing agent code so
# startup failures and unhandled exceptions land in the Apps log stream.
from scripts.app_diagnostics import install_diagnostics  # noqa: E402

install_diagnostics()

from pathlib import Path

from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load environment variables from .env if it exists
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

# Need to import the agent to register the functions with the server
# Set the env vars before importing the agent for proper auth
import agent_server.agent  # noqa: E402

agent_server = AgentServer()
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def main():
    # to support multiple workers, import the app defined above as a string
    agent_server.run(app_import_string="agent_server.start_server:app")
