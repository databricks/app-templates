# Backend

One Python process serves the agent, the `/api` routes and the built frontend ([Components](architecture.md#components)).

## Layout

- `app/agent.toml`: `deployment_name` (the app is `agent-bricks-<deployment_name>`), required user authorization with the `ai-gateway` and `sql` scopes, and the session store.
- `app/app.yaml`: the start command (`python -m uvicorn runtime.main:app`) and env from the `app_warehouse` resource.
- `app/runtime/`: `main.py` (the server), `adapter.py` (the invocation handler), `streaming.py` (events), `schemas.py` (input models), `auth.py` (the caller and the app client), `stores.py`, and `routers/`: `users.py` (`/api/me`, `/api/models`), `conversations.py` (`/api/sessions`), `invocations.py` (Stop), `activity.py`, `feedback.py`, and the use case's `user_data.py` and `reference_data.py`.
- `app/agent/`: `agent.py` (the agent and its bounds), `context.py` (the per-request context), `mcps.py` (MCP servers, none in this example), `approvals.py`, `procedures.py`, `gateway.py`, `models.toml` and `models.py`, `compaction.py`, `cancellation.py`, `activity.py`, `statement_execution.py`, `settings.py`.
- `app/agent/tools/`: the function tools, collected by `all_tools()`. `display.py` and `calculate.py` are generic; `user_data.py`, `reference_data.py` and `actions.py` are the use case's.
- `app/agent/prompts/`: `system.md` (the instructions), `step.md` (every tool's `step` argument), `compact.md` (the summary request).

The app stops at start without `APP_CATALOG`, `APP_PROJECT` or `APP_WAREHOUSE_ID`, and refuses an invocation without the user's credentials (`MCP_USER_AUTH_REQUIRED`).

## Run bounds

`app/agent/agent.py` bounds each question's run:

- The model sees the history from the tenth-last question on (`HISTORY_TURNS`), cut at a question so no tool call loses its output. A model that reads no images gets a line for each earlier image.
- A run makes at most 10 model calls (`MAX_TURNS`), then replies "We couldn't finish this request in one go. Ask for one thing at a time." with status `TURNS_EXCEEDED`.
- Each call writes at most 16,000 output tokens (`MAX_TOKENS`).
- A question has one user message of at most 4,000 characters and 3 images (`app/runtime/schemas.py`).

Each round of tool calls, displays included, costs one model call. The system message has one `ephemeral` `cache_control` breakpoint, caching the tools and instructions as one prefix.

## Reads

The model reads only through fixed-query function tools ([why](architecture.md#design-decisions)).

- `app/agent/tools/user_data.py` reads on behalf of the user (`request.client_for("user")`); `reference_data.py` reads as the app's service principal (`client_for("app")`).
- `run_query` (`app/agent/statement_execution.py`) cancels a statement after 50 seconds and refuses a result over one chunk.
- Each read emits a `tool_event` with its tool, identity (`user` or `app`), target `<catalog>.<schema>.<table>`, outcome (`allowed` or `denied`), call ID, and `QUERY_TIMEOUT` on a timeout. These become Activity rows and the answer's sources.
- A failed read gives the model a short "unavailable" line, logs one record ([Logs](runbook.md#logs)) and fails the tool's trace span.
- The use case's page routes (`app/runtime/routers/user_data.py`, `reference_data.py`) run the same queries and fail with 403 (`PERMISSION_DENIED`), 504 (`QUERY_TIMEOUT`) or 502, with only the code.

To add a read, write a `@function_tool` in `app/agent/tools/` with a `step: Step` argument, a fixed query, its identity and a `tool_event` per outcome, and add its Activity labels to `frontend/src/config/tools.ts`.

## Propose and confirm

A change takes two invocations on one session ([Confirm a change](architecture.md#confirm-a-change)):

1. Propose. A tool in `app/agent/tools/actions.py`, made with `proposal_tool`, checks its arguments and calls `propose`, which emits `confirmation_required` with a new `proposal_id`, the `action`, the card's `args` and the procedure's `arguments`. Bad arguments give the model "Not prepared, so no card was shown: check <fields>."
2. Decide. The card starts a run whose input is only `{"confirm": {"proposal_id": "...", "decision": "approve" | "reject"}}`. `answer_confirmation` runs `confirm` in a `confirm` trace span, with no model call.
3. Call. `confirm` (`app/agent/approvals.py`) finds the proposal in the stored events and its action in `ACTIONS`. On approve, `ProcedureClient` (`app/agent/procedures.py`) calls the procedure on behalf of the user with the key `sha256(<session ID>:<proposal ID>)`. A Delta conflict (`[DELTA_CONCURRENT_`) is retried at most twice with the same key within 45 seconds, and no statement is cancelled.
4. Record. A `tool_event` records the `proposal_id` and the outcome: `allowed` (`OK` or `OK_REPLAYED`), `denied` or `rejected_by_user`. The session gets "I confirmed this change." or "I cancelled this change." and the reply.
5. Unknown outcome. A failed or late call fails the run, and the card says the change won't be made twice; Try again sends the same decision.

A decision on a cancelled proposal, or a cancel after a decision, changes nothing and says so.

To add an action, write a procedure in `sql/data/procedures.sql` with its `EXECUTE` grant in `sql/data/user_grants.sql`, an `Action` in `ACTIONS` (the procedure's name, the SQL that binds its inputs, the done text), a propose tool, and card text in `frontend/src/config/actions.ts`. Without card text, the action gets a generic card.

## Displays and grounding

Display tools (`app/agent/tools/display.py`) each emit `{"type": "display", "call_id", "view", "payload"}` and change nothing. Each item gives the tool, its view and the values the check covers.

- `show_table` (`table`): every cell, at most 8 columns and 50 rows.
- `show_number` (`number`): the value.
- `show_details` (`details`): each value.
- `ask_user` (`questions`): each answer's label and description.
- `show_suggestion` (`suggestion`): the reason.
- `show_comparison` (`comparison`): each option's headline and traits.
- `update_plan` (`plan`): none.
- `show_report` (`report`): each section's summary, with only the sources this run read.

Grounding. `RecordReads`, the agent's hooks, keeps every non-display tool's output and the text of each user message the model reads on `RequestContext.reads`. `show` refuses a display unless every checked number is in those reads or is a whole number from 0 to 100. The refusal tells the model how many values weren't found, and one WARNING record (`NOT_GROUNDED`) logs the count. Titles, questions, labels and plan steps aren't checked, and image data never counts.

Arithmetic. `calculate` (`app/agent/tools/calculate.py`) takes up to 50 expressions, parsed with `ast`: only numbers, `+ - * / **` and parentheses, in 34-digit `Decimal`. Each number must pass the display check or be 1000, an exponent must be a whole number up to 1200, and a division by zero or a result over 10^15 is refused (status `NOT_CALCULATED`). Results, rounded to the cent, join the reads. The output never repeats an expression.

To add a view, write a tool in `display.py` that calls `show` with the values to check, add its name to `DISPLAY_TOOLS` and a renderer to `frontend/src/features/chat/components/displays.tsx`, and say when to use it in `app/agent/prompts/system.md`.

## Models and effort

`app/agent/models.toml` lists the models, the default first, each with an `id` (the model service in `<catalog>.<project>_ops`, [rate limits](runbook.md#models-and-rate-limits)), a `name` (the menu label), `images`, `reasoning` (`between_tools` or `adaptive`, a row of `EFFORTS` in `app/agent/agent.py`) and `context_window` (for the context ring). The app reads it once at start and refuses an unknown `reasoning`, and `GET /api/models` returns it with no workspace call.

A question may name `model` (default the first) and `effort` (`low`, `medium` or `high`, default `low`). The adapter refuses an unknown model, or images the model can't read, before it replaces a turn. `between_tools` at Low thinks between tool calls with no summary; every other choice thinks adaptively with summaries. The default, Claude Sonnet 5.5, uses `between_tools`; Claude Opus 5.5 reads images and uses `adaptive`, because it always thinks and rejects `between_tools`.

Model calls run on behalf of the user (`GatewayOpenAI` with `use_ai_gateway=True`). `GatewayCompletions` moves Claude's thinking summaries to `reasoning_content`, which the SDK streams as reasoning.

To add a model, add a model service file in `resources/model/` with a bundle variable for its foundation model, run a bundle deploy, add an entry to `models.toml`, then run an agent deploy.

## Event stream

`POST /api/invocations` with `{"id", "session_id", "input", "stream": true}` starts a run and streams server-sent events; `GET /api/invocations/{id}/events?after=<n>` replays those after event `n`. The runtime namespaces both IDs by the user and sends `run.started`, `run.completed` and `run.failed`. Each `request.emit` is one runtime store write, so text is batched. The app's events, by sender:

- `adapter.py`: `replaced` before a run that replaces the last turn; `received` (`at`) when a question's run starts; `stopped` after Stop; `message` for a fixed reply; and `usage` (`requests`, `input_tokens`, `output_tokens`, and for a question `context_tokens`, the last call's input and output) at the end of a question's run, also after a failed model call, and of a `/compact` that summarised, never of a decision.
- `agent.py`: `trace` (`trace_id`) when tracing is on.
- `RequestContext.tool_event`: `tool_event` ([Reads](#reads), plus `at` and, as they apply, `status`, `code`, `proposal_id`, `reference`, `acted_as`, `error`) for the first model response, a failed model call, each read and each decision.
- `streaming.py`: `delta`, answer text batched to about 40 characters or 100 ms; `narration`, a tool-calling response's text, which replaces the streamed text; `reasoning`, a thinking summary batched the same way; `status` (`step` is the call ID, `tool`, `text`, `at`) once a call with a `step` argument is written; `step.done` (`step`, `at`) when its output is back; `work.done` (`seconds` from the run's start until the answer's text began) just before the answer; and `message`, the response without tool calls.
- `display.py`: `display` when a display passed its check; `approvals.py`: `confirmation_required`.

`usage` is the last event before Activity is written; the evals count its tokens ([Event replay](frontend.md#event-replay)).

## Conversations

A conversation is a session in the session store named in `[session_store]` (`app/agent.toml`).

- `POST /api/sessions` creates one with a title, as the app's service principal, with the caller's email as actor and the conversation ID in its metadata. The session ID is the runtime's hash of the workspace, app, user and conversation ID, so no user can name another's.
- `GET /api/sessions` lists the caller's 50 most recent. `GET /api/sessions/{id}` returns the title, the messages, each run's input and stored events, and any run still going. `PATCH` renames. `DELETE` deletes for good, or returns 409 while a run is going. Another user's conversation gets 404.
- Opening, confirming, replacing, deleting and sending feedback use a private API ([Two private APIs are pinned](architecture.md#two-private-apis-are-pinned)).

Replace. Edit, Regenerate and Continue after Stop send `replace: true`. The adapter refuses if the last turn, from its `received` event on, proposed or decided a change. If the turn reached the model, `drop_last_turn` pops its session items one at a time, as the app's service principal. The run sends `replaced` and goes on as a new question.

Stop. The app posts `/api/invocations/{id}/cancel` with the conversation's ID. `app/agent/cancellation.py` keeps each streaming run in process memory, by session and run ID, and calls `cancel(mode="after_turn")`: the current model response and its tool calls finish, then the run sends `stopped` and `usage`. The route returns `{"stopped": false}` when the run isn't in this process, as before it registers or on another instance. The run, its replays and the stop carry `X-Routing-Key` with the conversation's ID. Only a question's run offers Stop: a decision must finish, and `/compact` registers no run.

Compact. `{"command": "compact"}` comes alone. `app/agent/compaction.py` keeps the last 2 questions and what followed, and summarises the older items in one call on the default model with `prompts/compact.md`, at most 1,000 tokens and no images. It rewrites the session as the summary and the kept items, restoring the old items if that write fails. With 2 questions or fewer, nothing changes. It sends no `received` or `context_tokens`.

## Feedback

`POST /api/feedback` (`app/runtime/routers/feedback.py`) takes `conversation_id`, `run_id`, `helpful` and an optional `comment` of up to 2,000 characters. It refuses other fields, so a client can't name a trace.

1. A conversation that isn't the caller's gets 404, as does a run without a `trace` event (tracing off).
2. As the app's service principal, `mlflow.get_trace` reads the trace. `mlflow.override_feedback` replaces the caller's current rating, keeping the old one marked invalid; without one, `mlflow.log_feedback` adds the first. The source is `HUMAN` with the caller's email; the comment is the rationale.
3. An MLflow failure returns 502 and logs only the error code; the app reverts the thumbs.

A trace MLflow can't read yet gets a first rating. On Unity Catalog that read can wait up to 15 seconds, and two ratings sent at once can both log as first.

## Guardrail blocks

A service policy block arrives as HTTP 200 with a `databricks_service_policy` object ([Guardrails](evaluation.md#guardrails)). `GatewayCompletions` checks every chunk and whole response for it and raises `PolicyBlocked` before any blocked text. A provider content-filter refusal (`finish_reason: "content_filter"`, no content) arrives as the Agents SDK's `ModelRefusalError`, which `app/agent/compaction.py` also raises for a filtered summary.

`model_reply` in `app/runtime/errors.py` maps each failed model call to a reply, an Activity outcome and a status: a policy block or content filter to `denied` and `POLICY_BLOCKED`, HTTP 429 to `denied` and `RATE_LIMITED`, HTTP 403 to `denied` and `NOT_ALLOWED`, other API errors to `failed` and `FAILED`. The run logs one record ([Logs](runbook.md#logs)), emits a `tool_event` for `model` and answers with the reply, also in `/compact`. [Event replay](frontend.md#event-replay) covers the UI's side.
