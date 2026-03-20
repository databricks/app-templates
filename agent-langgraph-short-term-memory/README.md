# Responses API Agent (Short-Term Memory)

## Build with AI Assistance

This template includes Claude Code skills in `.claude/skills/` for AI-assisted development. Use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to:

- **Set up your environment**: "Run quickstart to configure authentication"
- **Add tools**: "Connect my agent to a Genie space"
- **Configure memory**: "Set up Lakebase for conversation history"
- **Deploy**: "Deploy my agent to Databricks Apps"
- **Debug**: "Why am I getting a permission error?"

The skills contain tested commands, code patterns, and troubleshooting steps.

---

This template defines a conversational agent app with short-term memory. The app comes with a built-in chat UI, but also exposes an API endpoint for invoking the agent so that you can serve your UI elsewhere (e.g. on your website or in a mobile app).

The agent in this template implements the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. It has access to a single tool; the [built-in code interpreter tool](https://docs.databricks.com/aws/en/generative-ai/agent-framework/code-interpreter-tools#built-in-python-executor-tool) (`system.ai.python_exec`) on Databricks. You can customize agent code and test it via the API or UI.

The agent input and output format are defined by MLflow's ResponsesAgent interface, which closely follows the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. See [the MLflow docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/) for input and output formats for streaming and non-streaming requests, tracing requirements, and other agent authoring details.

## Quick start

Run the `uv run quickstart` script to quickly set up your local environment and start the agent server. At any step, if there are issues, refer to the manual local development loop setup below.

This script will:

1. Verify uv, nvm, and Databricks CLI installations
2. Configure Databricks authentication
3. Configure agent tracing, by creating and linking an MLflow experiment to your app
4. Start the agent server and chat app

```bash
uv run quickstart
```

After the setup is complete, you can start the agent server and the chat app locally with:

```bash
uv run start-app
```

This will start the agent server and the chat app at http://localhost:8000.

**Next steps**: see [modifying your agent](#modifying-your-agent) to customize and iterate on the agent code.

## Manual local development loop setup

1. **Set up your local environment**
   Install `uv` (python package manager), `nvm` (node version manager), and the Databricks CLI:

   - [`uv` installation docs](https://docs.astral.sh/uv/getting-started/installation/)
   - [`nvm` installation](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating)
     - Run the following to use Node 20 LTS:
       ```bash
       nvm use 20
       ```
   - [`databricks CLI` installation](https://docs.databricks.com/aws/en/dev-tools/cli/install)

2. **Set up local authentication to Databricks**

   In order to access Databricks resources from your local machine while developing your agent, you need to authenticate with Databricks. Choose one of the following options:

   **Option 1: OAuth via Databricks CLI (Recommended)**

   Authenticate with Databricks using the CLI. See the [CLI OAuth documentation](https://docs.databricks.com/aws/en/dev-tools/cli/authentication#oauth-user-to-machine-u2m-authentication).

   ```bash
   databricks auth login
   ```

   Set the `DATABRICKS_CONFIG_PROFILE` environment variable in your .env file to the profile you used to authenticate:

   ```bash
   DATABRICKS_CONFIG_PROFILE="DEFAULT" # change to the profile name you chose
   ```

   **Option 2: Personal Access Token (PAT)**

   See the [PAT documentation](https://docs.databricks.com/aws/en/dev-tools/auth/pat#databricks-personal-access-tokens-for-workspace-users).

   ```bash
   # Add these to your .env file
   DATABRICKS_HOST="https://host.databricks.com"
   DATABRICKS_TOKEN="dapi_token"
   ```

   See the [Databricks SDK authentication docs](https://docs.databricks.com/aws/en/dev-tools/sdk-python#authenticate-the-databricks-sdk-for-python-with-your-databricks-account-or-workspace).

3. **Create and link an MLflow experiment to your app**

   Create an MLflow experiment to enable tracing and version tracking. This is automatically done by the `uv run quickstart` script.

   Create the MLflow experiment via the CLI:

   ```bash
   DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
   databricks experiments create-experiment /Users/$DATABRICKS_USERNAME/agents-on-apps
   ```

   Make a copy of `.env.example` to `.env` and update the `MLFLOW_EXPERIMENT_ID` in your `.env` file with the experiment ID you created. The `.env` file will be automatically loaded when starting the server.

   ```bash
   cp .env.example .env
   # Edit .env and fill in your experiment ID
   ```

   See the [MLflow experiments documentation](https://docs.databricks.com/aws/en/mlflow/experiments#create-experiment-from-the-workspace).

4. **Test your agent locally**

   Start up the agent server and chat UI locally:

   ```bash
   uv run start-app
   ```

   Query your agent via the UI (http://localhost:8000) or REST API:

   **Advanced server options:**

   ```bash
   uv run start-server --reload   # hot-reload the server on code changes
   uv run start-server --port 8001 # change the port the server listens on
   uv run start-server --workers 4 # run the server with multiple workers
   ```

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
   - Example request with thread ID (for stateful agent):
     ```bash
     curl -X POST http://localhost:8000/invocations \
     -H "Content-Type: application/json" \
     -d '{
         "input": [{"role": "user", "content": "What did we discuss?"}],
         "custom_inputs": {"thread_id": "<thread-id>"}
     }'
     ```

## Modifying your agent

See the [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/quickstart) for more information on how to edit your own agent.

Required files for hosting with MLflow `AgentServer`:

- `agent.py`: Contains your agent logic. Modify this file to create your custom agent. For example, you can [add agent tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool) to give your agent additional capabilities
- `start_server.py`: Initializes and runs the MLflow `AgentServer` with agent_type="ResponsesAgent". You don't have to modify this file for most common use cases, but can add additional server routes (e.g. a `/metrics` endpoint) here

**Common customization questions:**

**Q: Can I add additional files or folders to my agent?**
Yes. Add additional files or folders as needed. Ensure the script within `pyproject.toml` runs the correct script that starts the server and sets up MLflow tracing.

**Q: How do I add dependencies to my agent?**
Run `uv add <package_name>` (e.g., `uv add "mlflow-skinny[databricks]"`). See the [python pyproject.toml guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#dependencies-and-requirements).

**Q: Can I add custom tracing beyond the built-in tracing?**
Yes. This template uses MLflow's agent server, which comes with automatic tracing for agent logic decorated with `@invoke()` and `@stream()`. It also uses [MLflow autologging APIs](https://mlflow.org/docs/latest/genai/tracing/#one-line-auto-tracing-integrations) to capture traces from LLM invocations. However, you can add additional instrumentation to capture more granular trace information when your agent runs. See the [MLflow tracing documentation](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/).

**Q: How can I extend this example with additional tools and capabilities?**
This template can be extended by integrating additional MCP servers, Vector Search Indexes, UC Functions, and other Databricks tools. See the ["Agent Framework Tools Documentation"](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool).

## Evaluating your agent

Evaluate your agent by calling the invoke function you defined for the agent locally.

- Update your `evaluate_agent.py` file with the preferred evaluation dataset and scorers.

Run the evaluation using the evaluation script:

```bash
uv run agent-evaluate
```

After it completes, open the MLflow UI link for your experiment to inspect results.

## Deploying to Databricks Apps

This template uses [Databricks Asset Bundles (DABs)](https://docs.databricks.com/aws/en/dev-tools/bundles/) for deployment. The `databricks.yml` file defines the app configuration and resource permissions.

Ensure you have the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/tutorial) installed and configured.

1. **Run the pre-flight check**

   Start the agent locally, send a test request, and verify the response to catch configuration and code errors early:

   ```bash
   uv run preflight
   ```

2. **Validate the bundle configuration**

   Catch any configuration errors before deploying:

   ```bash
   databricks bundle validate
   ```

3. **Deploy the bundle**

   This uploads your code and configures resources (MLflow experiment, Lakebase instance, etc.) defined in `databricks.yml`:

   ```bash
   databricks bundle deploy
   ```

4. **Start or restart the app**

   ```bash
   databricks bundle run agent_langgraph_short_term_memory
   ```

   > **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is **required** to actually start/restart the app with the new code.

   To grant access to additional resources (serving endpoints, genie spaces, UC Functions, Vector Search), add them to `databricks.yml` and redeploy. See the [Databricks Apps resources documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources).

   **On-behalf-of (OBO) User Authentication**: Use `get_user_workspace_client()` from `agent_server.utils` to authenticate as the requesting user instead of the app service principal. See the [OBO authentication documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#retrieve-user-authorization-credentials).

5. **Grant Lakebase permissions to your App's Service Principal**

   After deploying, you need to ensure your app has access to the necessary Lakebase tables for memory. The Lakebase instance is already configured as a resource in `databricks.yml`, but you'll need to grant Postgres-level permissions on schemas and tables that were created during local testing.

   > **Autoscaling Lakebase instances:** If your Lakebase instance is autoscaling (not provisioned), the postgres resource is **not yet supported** as a resource dependency in `databricks.yml`. After `databricks bundle run`, you must manually add the postgres resource to your app via the Databricks API, grant permissions, and then redeploy the app. See the [autoscaling Lakebase setup guide](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase) for detailed steps. Note that `databricks bundle deploy` will overwrite app resources, so you must re-add the postgres resource after each bundle deploy.

   **For provisioned Lakebase instances**, run the following SQL commands on your Lakebase instance (replace `app-sp-id` with your app's service principal UUID):

   ```sql
   DO $$
   DECLARE
      app_sp text := 'app-sp-id';  -- TODO: Replace with your App's Service Principal ID here
   BEGIN
      -------------------------------------------------------------------
      -- Drizzle schema: migration metadata tables
      -------------------------------------------------------------------
      EXECUTE format('GRANT USAGE, CREATE ON SCHEMA drizzle TO %I;', app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA drizzle TO %I;', app_sp);
      -------------------------------------------------------------------
      -- App schema: business tables (Chat, Message, etc.)
      -------------------------------------------------------------------
      EXECUTE format('GRANT USAGE, CREATE ON SCHEMA ai_chatbot TO %I;', app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ai_chatbot TO %I;', app_sp);
      -------------------------------------------------------------------
      -- Public schema for checkpoint tables
      -------------------------------------------------------------------
      EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I;', app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_migrations TO %I;', app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_writes TO %I;',       app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoints TO %I;',             app_sp);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_blobs TO %I;',        app_sp);
   END $$;
   ```

6. **Query your agent hosted on Databricks Apps**

   You must use a Databricks OAuth token to query agents hosted on Databricks Apps. See [Query an agent](https://docs.databricks.com/aws/en/generative-ai/agent-framework/query-agent) for full details.

   **Using the Databricks OpenAI client (Python):**

   ```bash
   uv pip install databricks-openai
   ```

   ```python
   from databricks.sdk import WorkspaceClient
   from databricks_openai import DatabricksOpenAI

   w = WorkspaceClient()
   client = DatabricksOpenAI(workspace_client=w)

   # Non-streaming
   response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "hi"}],
   )
   print(response)

   # Streaming
   streaming_response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "hi"}],
       stream=True,
   )
   for chunk in streaming_response:
       print(chunk)

   # With custom inputs (e.g., thread ID for stateful conversations)
   response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "What did we discuss?"}],
       extra_body={"custom_inputs": {"thread_id": "<thread-id>"}},
   )
   ```

   **Using curl:**

   ```bash
   # Generate an OAuth token
   databricks auth login --host <https://host.databricks.com>
   databricks auth token
   ```

   ```bash
   # Streaming request
   curl --request POST \
     --url <app-url>.databricksapps.com/responses \
     --header "Authorization: Bearer <oauth-token>" \
     --header "Content-Type: application/json" \
     --data '{
       "input": [{ "role": "user", "content": "hi" }],
       "stream": true
     }'
   ```

   ```bash
   # Request with thread ID (for stateful conversations)
   curl --request POST \
     --url <app-url>.databricksapps.com/responses \
     --header "Authorization: Bearer <oauth-token>" \
     --header "Content-Type: application/json" \
     --data '{
       "input": [{ "role": "user", "content": "What did we discuss?" }],
       "custom_inputs": { "thread_id": "<thread-id>" }
     }'
   ```

For future updates, run `databricks bundle deploy` and `databricks bundle run agent_langgraph_short_term_memory` to redeploy.

### Common Issues

- **`databricks bundle deploy` fails with "An app with the same name already exists"**

  This happens when an app with the same name was previously created outside of DABs. To fix, bind the existing app to your bundle:

  ```bash
  # 1. Get the existing app's config (note the budget_policy_id if present)
  databricks apps get <app-name> --output json | jq '{name, budget_policy_id, description}'

  # 2. Update databricks.yml to include budget_policy_id if it was returned above

  # 3. Bind the existing app to your bundle
  databricks bundle deployment bind agent_langgraph_short_term_memory <app-name> --auto-approve

  # 4. Deploy
  databricks bundle deploy
  ```

  Alternatively, delete the existing app and deploy fresh: `databricks apps delete <app-name>` (this permanently removes the app's URL and service principal).

- **`databricks bundle deploy` fails with "Provider produced inconsistent result after apply"**

  The existing app has server-side configuration (like `budget_policy_id`) that doesn't match your `databricks.yml`. Run `databricks apps get <app-name> --output json` and sync any missing fields to your `databricks.yml`.

- **App is running old code after `databricks bundle deploy`**

  `bundle deploy` only uploads files and configures resources. You must run `databricks bundle run agent_langgraph_short_term_memory` to actually start/restart the app with the new code.

### FAQ

- For a streaming response, I see a 200 OK in the logs, but an error in the actual stream. What's going on?
  - This is expected behavior. The initial 200 OK confirms stream setup; streaming errors don't affect this status.
- When querying my agent, I get a 302 error. What's going on?
  - Use an OAuth token. PATs are not supported for querying agents.
