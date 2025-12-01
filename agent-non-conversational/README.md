# Non-Conversational Agent

This example is a non-conversational agent that processes structured financial document questions and provides yes/no answers with detailed reasoning. Users provide both the document text and questions directly in the input, eliminating the need for vector search infrastructure in this simplified example. This demonstrates how non-conversational agents can handle specific, well-defined tasks without conversation context, while maintaining full traceability through MLflow 3.

## Quick start

Run the `./scripts/quickstart.sh` script to quickly set up your local environment and start the agent server. At any step, if there are issues, refer to the manual local development loop setup below.

This script will:

1. Verify UV and Databricks CLI installations
2. Configure Databricks authentication
3. Create and link an MLflow experiment

```bash
./scripts/quickstart.sh
```

After the setup is complete, you can start the agent server at port 8000 locally with:

```bash
uv run start-server
```

## Manual local development loop setup

1. **Set up your local environment**
   Install `uv` (python package manager) and the Databricks CLI:

   - [`uv` installation docs](https://docs.astral.sh/uv/getting-started/installation/)
   - [`databricks CLI` installation](https://docs.databricks.com/aws/en/dev-tools/cli/install)

2. **Set up local authentication to Databricks**

   In order to access Databricks resources from your local machine while developing your agent, you need to authenticate with Databricks. Choose one of the following options:

   **Option 1: OAuth via Databricks CLI (Recommended)**

   Authenticate with Databricks using the CLI. See the [CLI OAuth documentation](https://docs.databricks.com/aws/en/dev-tools/cli/authentication#oauth-user-to-machine-u2m-authentication).

   ```bash
   databricks auth login
   ```

   Set the `DATABRICKS_CONFIG_PROFILE` environment variable in your .env.local file to the profile you used to authenticate:

   ```bash
   DATABRICKS_CONFIG_PROFILE="DEFAULT" # change to the profile name you chose
   ```

   **Option 2: Personal Access Token (PAT)**

   See the [PAT documentation](https://docs.databricks.com/aws/en/dev-tools/auth/pat#databricks-personal-access-tokens-for-workspace-users).

   ```bash
   # Add these to your .env.local file
   # DATABRICKS_HOST="https://host.databricks.com"
   # DATABRICKS_TOKEN="dapi_token"
   ```

   See the [Databricks SDK authentication docs](https://docs.databricks.com/aws/en/dev-tools/sdk-python#authenticate-the-databricks-sdk-for-python-with-your-databricks-account-or-workspace).

3. **Create and link an MLflow experiment to your app**

   Create an MLflow experiment to enable tracing and version tracking. This is automatically done by the `./scripts/quickstart.sh` script.

   Create the MLflow experiment via the CLI:

   ```bash
   DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
   databricks experiments create-experiment /Users/$DATABRICKS_USERNAME/agents-on-apps
   ```

   Make a copy of `.env.example` to `.env.local` and update the `MLFLOW_EXPERIMENT_ID` in your `.env.local` file with the experiment ID you created. The `.env.local` file will be automatically loaded when starting the server.

   ```bash
   cp .env.example .env.local
   # Edit .env.local and fill in your experiment ID
   ```

   See the [MLflow experiments documentation](https://docs.databricks.com/aws/en/mlflow/experiments#create-experiment-from-the-workspace).

4. **Test your agent locally**

   Start up the agent server locally:

   ```bash
   uv run start-server
   ```

   **Advanced server options:**

   ```bash
   uv run start-server --reload   # hot-reload the server on code changes
   uv run start-server --port 8001 # change the port the server listens on
   uv run start-server --workers 4 # run the server with multiple workers
   ```

   Test your agent using the provided test script:

   ```bash
   # Test locally
   python test_agent.py

   # Test with specific URL
   python test_agent.py --url http://localhost:8000

   # Test with health check only
   python test_agent.py --url http://localhost:8000 --check-health
   ```

   Or query your agent via REST API request:

   ```bash
   curl -X POST http://localhost:8000/invocations \
     -H "Content-Type: application/json" \
     -d '{
       "document_text": "Total assets: $2,300,000. Total liabilities: $1,200,000. Shareholder equity: $1,100,000. Net income: $450,000. Revenues: $1,700,000. Expenses: $1,250,000.",
       "questions": [
         "Do the documents contain a balance sheet?",
         "Do the documents contain an income statement?"
       ]
     }'
   ```

5. **Modifying your agent**

   Required files for hosting with MLflow `AgentServer`:

   - `agent.py`: Contains your agent logic. Modify this file to create your custom agent.
   - `start_server.py`: Initializes and runs the MLflow `AgentServer` with agent_type=None.

   **Common customization questions:**

   **Q: Can I add additional files or folders to my agent?**
   Yes. Add additional files or folders as needed. Ensure the script within `pyproject.toml` runs the correct script that starts the server and sets up MLflow tracing.

   **Q: How do I add dependencies to my agent?**
   Run `uv add <package_name>` (e.g., `uv add "databricks-vectorsearch"`). See the [python pyproject.toml guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#dependencies-and-requirements).

   **Q: Can I add custom tracing beyond the built-in tracing?**
   Yes. While built-in MLflow tracing covers methods annotated with `@invoke()` and `@stream()`, you can further instrument your agent. See the [MLflow tracing documentation](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/). Search for `"start_span"` within `src/agent_server/server.py` for the built-in implementation.

   **Q: How can I extend this example for production use?**
   This simplified example can be easily extended by integrating additional capabilities:
   - **Vector Search**: Integrate Databricks Vector Search for document retrieval instead of direct text input
   - **MCP Tools**: Add Model Context Protocol tools for external system integrations
   - **Databricks Agents**: Combine with other Databricks agents like Genie for structured data access
   - **Custom Tools**: Add domain-specific tools for specialized analysis

   See the Agent Framework ["Author AI Agents in Code" documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent).

### Evaluating your agent

Evaluate your agent by calling the invoke function you defined for the agent locally.

- Update your `evaluate_agent.py` file with the preferred evaluation dataset and scorers.
- Your evaluation dataset must match the predict function signature. The wrapper takes a single argument named `data`, so each row should use `{"inputs": {"data": {...}}}` and the inner dict must match `AgentInput` (ex `document_text`, `questions: [{"text": str}]`).

Run the evaluation using the evaluation script:

```bash
uv run agent-evaluate
```

After it completes, open the MLflow UI link for your experiment to inspect results.

## Deploying to Databricks Apps

0. **Create a Databricks App**:
   Ensure you have the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/tutorial) installed and configured.

   ```bash
   databricks apps create agent-non-conversational
   ```

1. **Set up authentication to Databricks resources**

   For this example, you need to add an MLflow Experiment as a resource to your app. Grant the App's Service Principal (SP) permission to edit the experiment [manually in the MLflow experiments UI](https://docs.databricks.com/aws/en/mlflow/experiments#change-permissions-for-an-experiment). See the [Apps authorization docs](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#app-authorization) to find the SP's ID in the App Details page.

   To access resources like serving endpoints, genie spaces, MLflow experiments, UC Functions, and Vector Search Indexes, click `edit` on your app home page to grant the App's SP permission. See the [Databricks Apps resources documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources).

   For resources that are not supported yet, see the [Agent Framework authentication documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/deploy-agent#automatic-authentication-passthrough) for the correct permission level to grant to your app SP.

   **On-behalf-of (OBO) User Authentication**: Use `get_user_workspace_client()` from `agent_server.utils` to authenticate as the requesting user instead of the app service principal. See the [OBO authentication documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#retrieve-user-authorization-credentials).

2. **Sync local files to your workspace**

   See the [Databricks Apps deploy documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy?language=Databricks+CLI#deploy-the-app).

   ```bash
   DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
   databricks sync . "/Users/$DATABRICKS_USERNAME/agent-non-conversational"
   ```

3. **Deploy your Databricks App**

   See the [Databricks Apps deploy documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy?language=Databricks+CLI#deploy-the-app).

   ```bash
   databricks apps deploy agent-non-conversational --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/agent-non-conversational
   ```

4. **Query your agent hosted on Databricks Apps**

   You can now test your deployed agent using the test script with authentication:

   ```bash
   # Test with automatic OAuth token
   python test_agent.py --url <app-url.databricksapps.com>

   # Test with specific profile
   python test_agent.py --url <app-url.databricksapps.com> --profile your-profile

   # Test with manual token
   python test_agent.py --url <app-url.databricksapps.com> --token <oauth-token>
   ```

   Databricks Apps are _only_ queryable via OAuth token. You cannot use a PAT to query your agent. Generate an [OAuth token with your credentials using the Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/authentication#u2m-auth):

   ```bash
   databricks auth login --host <https://host.databricks.com>
   databricks auth token
   ```

   Send a request to the `/invocations` endpoint:

   ```bash
   curl -X POST <app-url.databricksapps.com>/invocations \
      -H "Authorization: Bearer <oauth token>" \
      -H "Content-Type: application/json" \
      -d '{
        "document_text": "Total assets: $2,300,000. Total liabilities: $1,200,000. Shareholder equity: $1,100,000. Net income: $450,000.",
        "questions": [
          "Do the documents contain a balance sheet?",
          "Do the documents contain an income statement?"
        ]
      }'
   ```

For future updates to the agent, sync and redeploy your agent.

### FAQ

- How is my agent being versioned in MLflow?
  - In `setup_mlflow_git_based_version_tracking()` from `agent_server/start_server.py`, we get the current git commit hash and use it to create a logged model, and all traces from that version of the agent will be logged to the corresponding model in MLflow on Databricks.
- How does this differ from a conversational agent?
  - Non-conversational agents process discrete requests without maintaining conversation context. They use `agent_type=None` to bypass conversational validation and support flexible input/output formats for task-specific processing.
- When querying my agent, I get a 302 error. What's going on?
  - Use an OAuth token. PATs are not supported for querying agents.
