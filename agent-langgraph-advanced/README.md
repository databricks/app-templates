# Responses API Agent (Advanced)

## Build with AI Assistance

This template includes Claude Code skills in `.claude/skills/` for AI-assisted development. Use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to:

- **Set up your environment**: "Run quickstart to configure authentication"
- **Add tools**: "Connect my agent to a Genie space"
- **Configure memory**: "Set up Lakebase for conversation history"
- **Deploy**: "Deploy my agent to Databricks Apps"
- **Debug**: "Why am I getting a permission error?"

The skills contain tested commands, code patterns, and troubleshooting steps.

---

This template defines a conversational agent app with **short-term memory**, **long-term memory**, and **long-running background tasks**. The app comes with a built-in chat UI, but also exposes an API endpoint for invoking the agent so that you can serve your UI elsewhere (e.g. on your website or in a mobile app).

The agent in this template implements the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. It has access to a single tool; the [built-in code interpreter tool](https://docs.databricks.com/aws/en/generative-ai/agent-framework/code-interpreter-tools#built-in-python-executor-tool) (`system.ai.python_exec`) on Databricks. You can customize agent code and test it via the API or UI.

The agent input and output format are defined by MLflow's ResponsesAgent interface, which closely follows the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. See [the MLflow docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/) for input and output formats for streaming and non-streaming requests, tracing requirements, and other agent authoring details.

## Template features

### Short-term memory (conversation history)

Short-term memory preserves conversation history within a session using `AsyncCheckpointSaver`. The agent remembers what was said earlier in the same conversation.

- Pass a `thread_id` in `custom_inputs` to maintain context across requests
- Stored in Lakebase (checkpoint tables)

### Long-term memory (user facts)

Long-term memory persists user preferences and information across conversation sessions using `AsyncDatabricksStore`. The agent has three memory tools:

- **get_user_memory** — search for previously saved facts about the user
- **save_user_memory** — store important facts, preferences, or details
- **delete_user_memory** — forget specific information when asked

Pass a `user_id` in `custom_inputs` to scope memories per user. Without a `user_id`, memory tools are disabled.

### Long-running background tasks

For agent tasks that may take longer than an HTTP timeout (~120s on Databricks Apps), the server supports background mode via `LongRunningAgentServer`. This decouples the agent's lifetime from the HTTP connection.

| Feature              | Standard mode                    | Background mode                       |
| -------------------- | -------------------------------- | ------------------------------------- |
| Request handling     | Blocking POST only               | Blocking POST + async background POST |
| Long-running support | No (timeout after ~120s on Apps) | Yes (1 hour default, configurable)    |
| Persistence          | None                             | Lakebase PostgreSQL                   |
| Stream resumption    | Not possible                     | Cursor-based via `starting_after=N`   |
| Server class         | MLflow `AgentServer`             | `LongRunningAgentServer` (extends it) |
| Retrieve endpoint    | N/A                              | `GET /responses/{id}`                 |

When Lakebase is not configured, background mode is disabled and the server falls back to standard request handling.

## Client Contract

This section defines how to call the agent via the OpenAI SDK and the corresponding raw REST requests. Replace `<base_url>` with `http://localhost:8000` (local) or `https://<app-name>.databricksapps.com` (deployed, with `Authorization: Bearer <oauth_token>` header).

All examples use the `POST /responses` endpoint. `/invocations` is an alias that behaves identically.

---

### 1. Standard Invocations (no background mode)

The POST blocks until the agent finishes.

#### Non-streaming (invoke)

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

Response: `{"output": [...]}`

#### Streaming

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

Response: SSE stream ending with `[DONE]`.

#### With memory

Pass `thread_id` for short-term memory (conversation continuity) and `user_id` for long-term memory (cross-session facts):

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{ "role": "user", "content": "Remember I prefer Python" }],
    "custom_inputs": { "thread_id": "<thread-id>", "user_id": "alice@example.com" }
  }'
```

---

### 2. Background Mode

Background mode (`background=true`) returns a `response_id` immediately and runs the agent asynchronously. The client uses the retrieve endpoint (`GET /responses/{id}`) to get results. Background mode requires a configured Lakebase database.

#### 2a. Kick off without stream + poll

The simplest background pattern. POST returns immediately with an ID; client polls GET until a terminal status.

```bash
# Kick off
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "background": true }'
# Returns: { "id": "resp_xxx", "status": "in_progress", ... }

# Poll (repeat until status is "completed" or "failed")
curl <base_url>/responses/resp_xxx
# Returns: { "id": "resp_xxx", "status": "completed", "output": [...] }
```

#### 2b. Kick off with stream + retrieve with stream (resumable streaming)

POST streams events on the initial connection. If the connection drops (e.g. Databricks Apps ~120s timeout), resume via GET with `stream=true` and `starting_after=<last_sequence_number>` to pick up where you left off.

Every SSE event includes a `sequence_number` (integer, monotonically increasing). Track this value — it's the cursor for resumption.

```bash
# Kick off with stream
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "stream": true, "background": true }'
# Returns: SSE stream with sequence_number on each event

# Resume from where you left off (e.g. last_seq was 5)
curl "<base_url>/responses/resp_xxx?stream=true&starting_after=5"
# Returns: SSE stream with events from sequence_number 6 onward
```

**SSE event format:**

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_xxx","status":"in_progress",...},"sequence_number":0}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Hello","sequence_number":1}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{...},"sequence_number":2}

data: [DONE]
```

Omitting `starting_after` on the GET replays all events from the beginning (no deduplication).

#### 2c. Kick off with stream + retrieve with poll (stream then collect)

POST streams events on the initial connection. If the connection drops, instead of resuming the stream, poll GET without `stream=true` to get the final completed response as JSON.

```bash
# Kick off with stream
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "stream": true, "background": true }'
# Returns: SSE stream (may drop before [DONE])

# Poll for final result (no stream=true)
curl <base_url>/responses/resp_xxx
# Returns: { "id": "resp_xxx", "status": "completed", "output": [...] }
```

---

### Retrieve Endpoint Reference

`GET /responses/{response_id}`

| Param            | Type    | Default | Description                                                                    |
| ---------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `stream`         | boolean | `false` | `true` returns SSE stream; `false` returns JSON                                |
| `starting_after` | integer | `0`     | Resume SSE stream after this sequence number (only applies when `stream=true`) |

### Status Values

| Status        | Meaning                                   |
| ------------- | ----------------------------------------- |
| `in_progress` | Agent is still running                    |
| `completed`   | Agent finished; `output` contains results |
| `failed`      | Agent errored; no output                  |

Terminal statuses: `completed`, `failed`. Stop polling/streaming when you see either.

### Summary

| Mode                                    | POST body                                   | POST response         | Retrieve                                           |
| --------------------------------------- | ------------------------------------------- | --------------------- | -------------------------------------------------- |
| Invoke                                  | `{ input }`                                 | JSON `{ output }`     | Not needed                                         |
| Stream                                  | `{ input, stream: true }`                   | SSE stream            | Not needed                                         |
| 2a: Background + poll                   | `{ input, background: true }`               | JSON `{ id, status }` | `GET /responses/{id}` until terminal               |
| 2b: Background + stream + stream resume | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}?stream=true&starting_after=N` |
| 2c: Background + stream + poll resume   | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}` until terminal               |

---

## Configuration

### Environment variables

Configure these in `.env` for local development, and in `databricks.yml` `config.env` for deployed apps.

**Authentication & tracing:**

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABRICKS_CONFIG_PROFILE` | Databricks CLI auth profile | `DEFAULT` |
| `MLFLOW_EXPERIMENT_ID` | MLflow experiment for tracing | _(set by quickstart)_ |

**Lakebase (required for memory and background mode):**

Lakebase powers both memory (short-term and long-term) and background mode persistence. Configure either a provisioned instance OR an autoscaling project/branch — not both.

| Variable | Description | Default |
|----------|-------------|---------|
| `LAKEBASE_INSTANCE_NAME` | Provisioned Lakebase instance name | _(option 1)_ |
| `LAKEBASE_AUTOSCALING_PROJECT` | Autoscaling Lakebase project | _(option 2)_ |
| `LAKEBASE_AUTOSCALING_BRANCH` | Autoscaling Lakebase branch | _(option 2)_ |
| `DATABRICKS_EMBEDDING_ENDPOINT` | Embedding model for long-term memory vector search | `databricks-gte-large-en` |

If no Lakebase variables are set, memory features and background mode are both disabled. The server falls back to stateless, standard request handling only.

**Background mode (LongRunningAgentServer):**

These settings control the `LongRunningAgentServer` behavior. They are read as environment variables in `agent_server/start_server.py` and passed to the server constructor.

| Variable | Description | Default |
|----------|-------------|---------|
| `TASK_TIMEOUT_SECONDS` | Max duration (in seconds) for a background agent task before it is marked as failed | `3600` (1 hour) |
| `POLL_INTERVAL_SECONDS` | How often (in seconds) the server checks for new events when serving a `GET /responses/{id}?stream=true` request | `1` |

The server constructor also accepts two additional settings that are not currently exposed as environment variables. To change them, edit `agent_server/start_server.py` directly:

| Constructor param | Description | Default |
|-------------------|-------------|---------|
| `db_statement_timeout_ms` | Timeout (in ms) for individual Lakebase SQL statements | `5000` |
| `cleanup_timeout_seconds` | Time (in seconds) allowed for graceful DB cleanup on shutdown. Must be greater than `db_statement_timeout_ms / 1000` | `7.0` |

### Agent model

The LLM endpoint is set in `agent_server/agent.py`:

```python
LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"
```

Change this to any [Databricks Model Serving endpoint](https://docs.databricks.com/aws/en/generative-ai/external-models/) (e.g., `databricks-meta-llama-4-maverick`, `databricks-claude-sonnet-4-5`).

### Server customization

The server is defined in `agent_server/start_server.py` as a subclass of `LongRunningAgentServer`:

```python
class AgentServer(LongRunningAgentServer):
    def transform_stream_event(self, event, response_id):
        return replace_fake_id(event, response_id)
```

You can override `transform_stream_event` to modify SSE events before they are sent to the client (or persisted for background mode retrieval). The base `LongRunningAgentServer` extends MLflow's `AgentServer`, so all standard server features (custom routes, middleware, etc.) are available.

## Quick start

Run the `uv run quickstart` script to quickly set up your local environment and start the agent server. At any step, if there are issues, refer to the manual local development loop setup below.

This script will:

1. Verify uv, nvm, and Databricks CLI installations
2. Configure Databricks authentication
3. Configure Lakebase for memory storage
4. Configure agent tracing, by creating and linking an MLflow experiment to your app
5. Start the agent server and chat app

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

   See the [Client contract](#client-contract) section below for all request patterns including streaming, memory, and background mode.

## Modifying your agent

See the [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/quickstart) for more information on how to edit your own agent.

Required files for hosting with MLflow `AgentServer`:

- `agent.py`: Contains your agent logic. Modify this file to create your custom agent. For example, you can [add agent tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool) to give your agent additional capabilities
- `start_server.py`: Initializes and runs the `LongRunningAgentServer` with agent_type="ResponsesAgent". You don't have to modify this file for most common use cases, but can add additional server routes (e.g. a `/metrics` endpoint) here

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
   databricks bundle run agent_langgraph_advanced
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

   ```bash
   # Generate an OAuth token
   databricks auth login --host <https://host.databricks.com>
   databricks auth token
   ```

   The [Client contract](#client-contract) section documents all request patterns. For deployed apps, replace `<base_url>` with `https://<app-name>.databricksapps.com` and add `Authorization: Bearer <oauth-token>` header.

   **Using the Databricks OpenAI client (Python):**

   ```bash
   uv pip install databricks-openai
   ```

   ```python
   from databricks.sdk import WorkspaceClient
   from databricks_openai import DatabricksOpenAI

   w = WorkspaceClient()
   client = DatabricksOpenAI(workspace_client=w)

   response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "hi"}],
   )
   print(response)
   ```

For future updates, run `databricks bundle deploy` and `databricks bundle run agent_langgraph_advanced` to redeploy.

### Common Issues

- **`databricks bundle deploy` fails with "An app with the same name already exists"**

  This happens when an app with the same name was previously created outside of DABs. To fix, bind the existing app to your bundle:

  ```bash
  # 1. Get the existing app's config (note the budget_policy_id if present)
  databricks apps get <app-name> --output json | jq '{name, budget_policy_id, description}'

  # 2. Update databricks.yml to include budget_policy_id if it was returned above

  # 3. Bind the existing app to your bundle
  databricks bundle deployment bind agent_langgraph_advanced <app-name> --auto-approve

  # 4. Deploy
  databricks bundle deploy
  ```

  Alternatively, delete the existing app and deploy fresh: `databricks apps delete <app-name>` (this permanently removes the app's URL and service principal).

- **`databricks bundle deploy` fails with "Provider produced inconsistent result after apply"**

  The existing app has server-side configuration (like `budget_policy_id`) that doesn't match your `databricks.yml`. Run `databricks apps get <app-name> --output json` and sync any missing fields to your `databricks.yml`.

- **App is running old code after `databricks bundle deploy`**

  `bundle deploy` only uploads files and configures resources. You must run `databricks bundle run agent_langgraph_advanced` to actually start/restart the app with the new code.

### FAQ

- For a streaming response, I see a 200 OK in the logs, but an error in the actual stream. What's going on?
  - This is expected behavior. The initial 200 OK confirms stream setup; streaming errors don't affect this status.
- When querying my agent, I get a 302 error. What's going on?
  - Use an OAuth token. PATs are not supported for querying agents.
