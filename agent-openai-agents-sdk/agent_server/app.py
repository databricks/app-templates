from fastapi.responses import StreamingResponse
from aiohttp.web import Request
from mlflow.genai.agent_server import AgentServer


class MlflowAgentServer(AgentServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._initialized = False

    async def _handle_invocations_request(self, *args, **kwargs):
        if not self._initialized:
            self._initialized = True
            from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking
            setup_mlflow_git_based_version_tracking()
        return await super()._handle_invocations_request(*args, **kwargs)


def create_app():
    # Need to import the agent to register the functions with the server
    import agent_server.agent
    from dotenv import load_dotenv

    # Load env vars from .env before importing the agent for proper auth
    load_dotenv(dotenv_path=".env", override=True)

    server = MlflowAgentServer("ResponsesAgent", enable_chat_proxy=True)
    return server.app
