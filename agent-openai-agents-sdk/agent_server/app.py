from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load env vars from .env before importing the agent for proper auth
load_dotenv(dotenv_path=".env", override=True)


agent_server = AgentServer("ResponsesAgent", enable_chat_proxy=True)
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841

print("hi")

# Need to import the agent to register the functions with the server
from agent_server import agent  # noqa: E402
