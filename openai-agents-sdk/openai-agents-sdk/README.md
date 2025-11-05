# Responses API Agent

This example is a simple agent that follows the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) with one tool, `system.ai.python_exec`, roughly following the example in the ["Author AI agents in code" documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent).

Refer to [the ResponsesAgent MLflow docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/) for more about input and output formats for streaming and non-streaming requests, tracing requirements, and other agent authoring details.

## Get started

0. **Set up your local environment**
   Install the latest versions of `uv` (python package manager) and `nvm` (node version manager):

   - [`uv` installation docs](https://docs.astral.sh/uv/getting-started/installation/)
   - [`nvm` installation](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating)
   - Run the following to use Node 20 LTS:
     ```bash
     nvm use 20
     ```

1. **Create and link an MLflow experiment to your app**

   Create an MLflow experiment in Databricks. Refer to the [MLflow experiments documentation](https://docs.databricks.com/aws/en/mlflow/experiments#create-experiment-from-the-workspace) for more info.

   ```bash
   cp .env.example .env.local
   # Edit .env.local and fill in your experiment ID
   # The .env.local file will be automatically loaded when starting the server
   ```

2. **Set up local authentication to Databricks**

   In order to access Databricks resources from your local machine while developing your agent, you need to authenticate with Databricks. Modify `.env.local` with one of the following options:

   - **Use a Databricks configuration profile**

     Refer to the [configuration profiles documentation](https://docs.databricks.com/aws/en/dev-tools/auth/config-profiles) for more info.

     ```bash
     databricks configure
     # Add the configuration profile to your .env.local file
     # DATABRICKS_CONFIG_PROFILE="DEFAULT"
     ```

   - **Use a personal access token (PAT)**

     Refer to the [PAT documentation](https://docs.databricks.com/aws/en/dev-tools/auth/pat#databricks-personal-access-tokens-for-workspace-users) for more info.

     ```bash
     # Add these to your .env.local file
     # DATABRICKS_HOST="https://host.databricks.com"
     # DATABRICKS_TOKEN="dapi_token"
     ```

   See the [Databricks SDK authentication docs](https://docs.databricks.com/aws/en/dev-tools/sdk-python#authenticate-the-databricks-sdk-for-python-with-your-databricks-account-or-workspace) for more info.

3. **Testing out your local agent**

   Start up the agent server locally:

   ```bash
   uv run start-server --reload

   # Other options for the start-server script:
   uv run start-server --port 8001
   uv run start-server --workers 4
   ```

   Now you can either query your agent via the built in UI (served by default at http://localhost:8000) or via REST API request:

   - Example streaming request:
     ```bash
     curl -X POST http://localhost:8000/invocations \
     -H "Content-Type: application/json" \
     -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
     ```
   - Example non-streaming request:
     ```bash
     curl -X POST http://localhost:8000/invocations  \
     -H "Content-Type: application/json" \
     -d '{ "input": [{ "role": "user", "content": "hi" }] }'
     ```

4. **Modifying your agent**

   You can check out the [OpenAI Agents SDK documentation](https://platform.openai.com/docs/guides/agents-sdk) for more information on how to edit your own agent.

   The following files are required to host your own agent with the MLflow `AgentServer`:

   - `agent.py`: This file contains your agent logic. It currently contains a Responses API agent. Please modify this file to create your custom agent.
   - `start_server.py`: This file initializes and runs the MLflow `AgentServer` with agent_type="ResponsesAgent".

   Common changes to make:

   - Feel free to add as many files or folders as you want to your agent, just make sure that the script within `pyproject.toml` runs the right script that will start the server and set up MLflow tracing.
   - To add dependencies to your agent, run `uv add <package_name>` (ex. `uv add "mlflow-skinny[databricks]"`). Refer to the [python pyproject.toml guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#dependencies-and-requirements) for more info.
   - While we have built-in MLflow tracing when calling the methods annotated with `@invoke()` and `@stream()`, you can also further instrument your own agent. Refer to the [MLflow tracing documentation](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/) for more info.
     - Search for `"start_span"` within `src/agent_server/server.py` for the built-in implementation.
   - Refer to the Agent Framework ["Author AI Agents in Code" documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent) for more information.

## Evaluating your agent

Evaluate your agent by calling the invoke function you defined for the agent locally.

- Update your `evaluate_agent.py` file with the preferred evaluation dataset and scorers.

Run the evaluation using the evaluation script:

```bash
uv run agent-evaluate
```

After it completes, open the MLflow UI link for your experiment to inspect results.

## Deploying to Databricks Apps

0. **Create a Databricks App**:
   Ensure you have the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/tutorial) installed and configured.

   ```bash
   databricks apps create agent-proto
   ```

1. **Set up authentication to Databricks resources**

   **App Authentication via Service Principal (SP)**: To access resources like serving endpoints, genie spaces, MLflow experiments, UC Functions, and Vector Search Indexes, you can click `edit` on your app home page to grant the App's SP permission. Refer to the [Databricks Apps resources documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources) for more info.

   For resources that are not supported yet, refer to the [Agent Framework authentication documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/deploy-agent#automatic-authentication-passthrough) for the correct permission level to grant to your app SP.

   **On-behalf-of (OBO) User Authentication**: Use `get_user_workspace_client()` from `agent_server.utils` to authenticate as the requesting user instead of the app service principal. Refer to the [OBO authentication documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#retrieve-user-authorization-credentials) for more info.

2. **Set the value of `MLFLOW_EXPERIMENT_ID` in `app.yaml`**

   The `MLFLOW_EXPERIMENT_ID` is the ID of the MLflow experiment you created in step 1. Open `app.yaml` for other env vars.
   Refer to the [Databricks Apps environment variable documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/environment-variables) for more info.

3. **Build the UI**

   ```bash
   (cd ui && npm run build)
   ```

4. **Sync local files to your workspace**

   Refer to the [Databricks Apps deploy documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy?language=Databricks+CLI#deploy-the-app) for more info.

   ```bash
   DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
   databricks sync . "/Users/$DATABRICKS_USERNAME/agent-proto"
   ```

5. **Deploy your Databricks App**

   Refer to the [Databricks Apps deploy documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy?language=Databricks+CLI#deploy-the-app) for more info.

   ```bash
   databricks apps deploy agent-proto --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/agent-proto
   ```

6. **Query your agent hosted on Databricks Apps**

   Databricks Apps are _only_ queryable via OAuth token. You cannot use a PAT to query your agent. Generate an [OAuth token with your credentials using the Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/authentication#u2m-auth):

   ```bash
   databricks auth login --host <https://host.databricks.com>
   databricks auth token
   ```

   You can now send a request to the `/invocations` endpoint, where your agent is hosted:

   - Example streaming request:

     ```bash
     curl -X POST <app-url.databricksapps.com>/invocations \
        -H "Authorization: Bearer <oauth token>" \
        -H "Content-Type: application/json" \
        -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
     ```

   - Example non-streaming request:

     ```bash
     curl -X POST <app-url.databricksapps.com>/invocations \
        -H "Authorization: Bearer <oauth token>" \
        -H "Content-Type: application/json" \
        -d '{ "input": [{ "role": "user", "content": "hi" }] }'
     ```

For future updates to the agent, you only need to sync and redeploy your agent. If making changes to the UI, you'll also have to rebuild the UI.

### FAQ

- For a streaming response, I see a 200 OK in the logs, but an error in the actual stream. What's going on?
  - This is expected. The server will return a 200 OK if the stream is set up without error, but any errors during the stream will not change the initial status code.
- When querying my agent, I get a 302 error. What's going on?
  - Please make sure you are using an OAuth token to query your agent. You cannot use a PAT to query your agent.
