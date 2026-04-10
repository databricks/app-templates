# Advanced Responses API Agent

This template defines a **stateful** conversational agent app with persistent conversation history, long-running background execution, and stream resumption — all backed by [Databricks Lakebase](https://docs.databricks.com/aws/en/lakebase/). The app comes with a built-in chat UI, but also exposes an API endpoint for invoking the agent so that you can serve your UI elsewhere (e.g. on your website or in a mobile app).

The agent implements the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface and is compatible with the [OpenAI Python SDK](https://github.com/openai/openai-python) — see the [Client Contract](#client-contract) below for usage examples. You can customize agent code and test it via the API or UI.

This template extends [agent-openai-agents-sdk](https://github.com/databricks/app-templates/tree/main/agent-openai-agents-sdk) with two capabilities:

1. **Short-term memory** — automatic conversation history via Lakebase-backed sessions
2. **Long-running background execution** — decouple agent lifetime from HTTP connections

Standard synchronous invoke/stream behavior is fully preserved when `background=false` (default), so this template is backward-compatible with the base.

The agent input and output format are defined by MLflow's ResponsesAgent interface, which closely follows the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. See [the MLflow docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/) for input and output formats for streaming and non-streaming requests, tracing requirements, and other agent authoring details.

---

## Features

### Short-Term Memory (Stateful Sessions)

This template uses OpenAI Agents SDK [Sessions](https://openai.github.io/openai-agents-python/sessions/) to automatically manage conversation history. Sessions store conversation history for a specific session, allowing agents to maintain context without requiring explicit manual memory management.

How it works:
- **Before each run**: The session retrieves prior conversation history and prepends it to the input
- **After each run**: New items (user messages, assistant responses, tool calls) are automatically stored in the session
- **Session ID**: Returned in `custom_outputs.session_id` — pass it back in subsequent requests to continue the conversation
- **Deduplication**: If the client sends the full conversation history and the session already has it, only the latest message is forwarded to avoid duplication

This template uses `AsyncDatabricksSession` from `databricks-openai`, which persists session data to a Databricks Lakebase instance. Session tables are created at server startup.

### Long-Running Background Execution

Databricks Apps enforces a ~120s HTTP connection timeout, which kills long-running agent responses. This template adds a `background=true` flag that returns a `response_id` immediately and runs the agent asynchronously. Clients poll or stream results via a separate `GET /responses/{id}` endpoint.

Key capabilities:
- **Connection resilience**: Clients can disconnect and reconnect without losing progress
- **Cursor-based resumption**: `starting_after=N` skips already-received events on reconnect
- **Polling**: Completed responses return full output from the database
- **Configurable timeouts**: `TASK_TIMEOUT_SECONDS` (default 1 hour) controls the maximum background task duration

The server uses `LongRunningAgentServer` from `databricks-ai-bridge`, which extends MLflow's `AgentServer` with background task management and a `GET /responses/{id}` retrieve endpoint. Stream events are persisted to Lakebase PostgreSQL for resumable streaming.

### Configuration

| Variable                  | Default       | Purpose                                   |
| ------------------------- | ------------- | ----------------------------------------- |
| `TASK_TIMEOUT_SECONDS`    | 3600 (1 hour) | Max duration for a background task        |
| `POLL_INTERVAL_SECONDS`   | 1.0           | Server-side polling delay in GET requests |

### Summary Table

| Aspect               | Base Template                    | This Template                         |
| -------------------- | -------------------------------- | ------------------------------------- |
| Session memory       | None                             | Lakebase-backed `AsyncDatabricksSession` |
| Request handling     | Blocking POST only               | Blocking POST + async background POST |
| Long-running support | No (timeout after ~120s on Apps) | Yes (1 hour default, configurable)    |
| Persistence          | None                             | Lakebase PostgreSQL                   |
| Stream resumption    | Not possible                     | Cursor-based via `starting_after=N`   |
| Retrieve endpoint    | N/A                              | `GET /responses/{id}`                 |

---

## Client Contract

This section defines how to call the agent via the OpenAI SDK and the corresponding raw REST requests. Replace `<base_url>` with `http://localhost:8000` (local) or `https://<app-name>.databricksapps.com` (deployed, with `Authorization: Bearer <oauth_token>` header).

All examples use the `POST /responses` endpoint. `/invocations` is an alias that behaves identically.

---

### 1. Standard Invocations (no background mode)

Identical to the base `agent-openai-agents-sdk` template. The POST blocks until the agent finishes.

#### Non-streaming (invoke)

**OpenAI SDK:**

```python
resp = client.responses.create(
    input=[{"role": "user", "content": "hi"}],
    model="agent",
)
print(resp.output)
```

**curl:**

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

Response: `{"output": [...]}`

#### Streaming

**OpenAI SDK:**

```python
stream = client.responses.create(
    input=[{"role": "user", "content": "hi"}],
    model="agent",
    stream=True,
)
for event in stream:
    process(event)
```

**curl:**

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

Response: SSE stream ending with `[DONE]`.

#### Multi-turn conversations (session memory)

Pass the `session_id` from the first response to continue the conversation:

**OpenAI SDK:**

```python
# First turn
resp = client.responses.create(
    input=[{"role": "user", "content": "My name is Alice"}],
    model="agent",
)
session_id = resp.custom_outputs["session_id"]

# Second turn — agent remembers the first turn
resp = client.responses.create(
    input=[{"role": "user", "content": "What's my name?"}],
    model="agent",
    extra_body={"custom_inputs": {"session_id": session_id}},
)
```

**curl:**

```bash
# First turn
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "My name is Alice" }] }'
# Response includes: "custom_outputs": { "session_id": "..." }

# Second turn
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "What'\''s my name?" }], "custom_inputs": { "session_id": "<session-id>" } }'
```

---

### 2. Background Mode

Background mode (`background=true`) returns a `response_id` immediately and runs the agent asynchronously. The client uses the retrieve endpoint (`GET /responses/{id}`) to get results. Background mode requires a configured Lakebase database.

#### 2a. Kick off without stream + poll

The simplest background pattern. POST returns immediately with an ID; client polls GET until a terminal status.

**OpenAI SDK:**

```python
# Kick off
resp = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    background=True,
)

# Poll
while resp.status in ("queued", "in_progress"):
    time.sleep(2)
    resp = client.responses.retrieve(resp.id)

print(resp.output)  # available when status == "completed"
```

**curl:**

```bash
# Kick off
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "background": true }'
# Returns: { "id": "resp_xxx", "status": "in_progress", ... }

# Poll (repeat until status is "completed" or "failed")
curl <base_url>/responses/resp_xxx
# Returns: { "id": "resp_xxx", "status": "in_progress" }
# ... eventually:
# Returns: { "id": "resp_xxx", "status": "completed", "output": [...] }
```

#### 2b. Kick off with stream + retrieve with stream (resumable streaming)

POST streams events on the initial connection. If the connection drops (e.g. Databricks Apps ~120s timeout), resume via GET with `stream=true` and `starting_after=<last_sequence_number>` to pick up where you left off.

Every SSE event includes a `sequence_number` (integer, monotonically increasing). Track this value — it's the cursor for resumption.

**OpenAI SDK:**

```python
# Kick off — stream from the POST connection
stream = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    stream=True,
    background=True,
)
response_id = None
last_seq = 0

for event in stream:
    if hasattr(event, "response"):
        response_id = event.response.id
    if hasattr(event, "sequence_number"):
        last_seq = event.sequence_number
    process(event)

# If connection dropped before [DONE], resume with stream
stream = client.responses.retrieve(
    response_id,
    stream=True,
    starting_after=last_seq,
)
for event in stream:
    process(event)
```

**curl:**

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

**OpenAI SDK:**

```python
# Kick off — stream from the POST connection
stream = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    stream=True,
    background=True,
)
response_id = None

for event in stream:
    if hasattr(event, "response"):
        response_id = event.response.id
    process(event)

# If connection dropped before [DONE], poll for the final result
resp = client.responses.retrieve(response_id)
while resp.status in ("queued", "in_progress"):
    time.sleep(2)
    resp = client.responses.retrieve(response_id)

print(resp.output)
```

**curl:**

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

### Error Events (SSE)

```
event: error
data: {"error":{"message":"Response not found","type":"not_found","code":"response_not_found"}}
```

### Summary

| Mode                                    | POST body                                   | POST response         | Retrieve                                           |
| --------------------------------------- | ------------------------------------------- | --------------------- | -------------------------------------------------- |
| Invoke                                  | `{ input }`                                 | JSON `{ output }`     | Not needed                                         |
| Stream                                  | `{ input, stream: true }`                   | SSE stream            | Not needed                                         |
| 2a: Background + poll                   | `{ input, background: true }`               | JSON `{ id, status }` | `GET /responses/{id}` until terminal               |
| 2b: Background + stream + stream resume | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}?stream=true&starting_after=N` |
| 2c: Background + stream + poll resume   | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}` until terminal               |

---

## Build with AI Assistance

We recommend using AI coding assistants (Claude Code, Cursor, GitHub Copilot) to customize and deploy this template. Agent Skills in `.claude/skills/` provide step-by-step guidance for common tasks like setup, adding tools, and deployment. These skills are automatically detected by Claude, Cursor, and GitHub Copilot.

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

## Modifying your agent

See the [OpenAI Agents SDK documentation](https://platform.openai.com/docs/guides/agents-sdk) for more information on how to edit your own agent.

Required files for hosting with MLflow `AgentServer`:

- `agent_server/agent.py`: Contains your agent logic. Modify this file to create your custom agent. For example, you can [add agent tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool) to give your agent additional capabilities
- `agent_server/start_server.py`: Initializes and runs the `LongRunningAgentServer` with agent_type="ResponsesAgent". You don't have to modify this file for most common use cases, but can add additional server routes (e.g. a `/metrics` endpoint) here

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

   This uploads your code and configures resources (MLflow experiment, serving endpoints, etc.) defined in `databricks.yml`:

   ```bash
   databricks bundle deploy
   ```

4. **Start or restart the app**

   ```bash
   databricks bundle run agent_openai_advanced
   ```

   > **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is **required** to actually start/restart the app with the new code.

   To grant access to additional resources (serving endpoints, genie spaces, UC Functions, Vector Search), add them to `databricks.yml` and redeploy. See the [Databricks Apps resources documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources).

   **On-behalf-of (OBO) User Authentication**: Use `get_user_workspace_client()` from `agent_server.utils` to authenticate as the requesting user instead of the app service principal. See the [OBO authentication documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#retrieve-user-authorization-credentials).

5. **Query your agent hosted on Databricks Apps**

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

   # With custom inputs (e.g., session ID for stateful conversations)
   response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "What did we discuss?"}],
       extra_body={"custom_inputs": {"session_id": "<session-id>"}},
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
   # Request with session ID (for stateful conversations)
   curl --request POST \
     --url <app-url>.databricksapps.com/responses \
     --header "Authorization: Bearer <oauth-token>" \
     --header "Content-Type: application/json" \
     --data '{
       "input": [{ "role": "user", "content": "What did we discuss?" }],
       "custom_inputs": { "session_id": "<session-id>" }
     }'
   ```

### Granting Lakebase Permissions

After deploying, the app's service principal needs Postgres-level permissions to access Lakebase tables. Use the included script to grant all required permissions at once:

```bash
# 1. Get the SP client ID from your deployed app
databricks apps get <app-name> --profile <profile> --output json | jq -r '.service_principal_client_id'

# 2. Grant permissions (reads LAKEBASE_INSTANCE_NAME from .env)
DATABRICKS_CONFIG_PROFILE=<profile> uv run python scripts/grant_lakebase_permissions.py <sp-client-id>
```

This grants USAGE + CREATE on the `agent_server`, `ai_chatbot`, and `drizzle` schemas, and SELECT/INSERT/UPDATE/DELETE on all tables within them.

## Testing

See `scripts/test_long_running_agent.py` for a Pytest suite that exercises all client modes (sync, stream, background + poll, background + stream with cursor resumption).

## Key Files

| File                                    | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `agent_server/agent.py`                 | Agent logic, model, instructions, MCP servers, session memory        |
| `agent_server/start_server.py`          | Server entry point, `LongRunningAgentServer` setup, Lakebase init    |
| `agent_server/utils.py`                 | Shared utilities (session ID, deduplication, stream event processing)|
| `agent_server/evaluate_agent.py`        | Agent evaluation with MLflow scorers                                 |
| `databricks.yml`                        | Bundle config with Lakebase + MLflow + app resources                 |
| `scripts/quickstart.py`                 | One-command setup script                                             |
| `scripts/discover_tools.py`             | Discovers available workspace resources                              |
| `scripts/grant_lakebase_permissions.py` | Grants Lakebase Postgres permissions to app SP                       |
| `scripts/test_long_running_agent.py`    | Pytest suite covering all client modes                               |

## Common Issues

- **`databricks bundle deploy` fails with "An app with the same name already exists"**

  This happens when an app with the same name was previously created outside of DABs. To fix, bind the existing app to your bundle:

  ```bash
  # 1. Get the existing app's config (note the budget_policy_id if present)
  databricks apps get <app-name> --output json | jq '{name, budget_policy_id, description}'

  # 2. Update databricks.yml to include budget_policy_id if it was returned above

  # 3. Bind the existing app to your bundle
  databricks bundle deployment bind agent_openai_advanced <app-name> --auto-approve

  # 4. Deploy
  databricks bundle deploy
  ```

  Alternatively, delete the existing app and deploy fresh: `databricks apps delete <app-name>` (this permanently removes the app's URL and service principal).

- **`databricks bundle deploy` fails with "Provider produced inconsistent result after apply"**

  The existing app has server-side configuration (like `budget_policy_id`) that doesn't match your `databricks.yml`. Run `databricks apps get <app-name> --output json` and sync any missing fields to your `databricks.yml`.

- **App is running old code after `databricks bundle deploy`**

  `bundle deploy` only uploads files and configures resources. You must run `databricks bundle run agent_openai_advanced` to actually start/restart the app with the new code.

### FAQ

- For a streaming response, I see a 200 OK in the logs, but an error in the actual stream. What's going on?
  - This is expected behavior. The initial 200 OK confirms stream setup; streaming errors don't affect this status.
- When querying my agent, I get a 302 error. What's going on?
  - Use an OAuth token. PATs are not supported for querying agents.

## References

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Background Streaming Guide](https://developers.openai.com/api/docs/guides/background/#streaming-a-background-response)
- [MLflow ResponsesAgent Docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/)
- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
