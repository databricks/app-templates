---
name: managed-memory-store
description: "Give the agent durable, cross-session long-term memory using Databricks MANAGED memory (the UC memory-store REST APIs) as function tools — governed, API-backed, no infra to run and no extra dependency. DISTINCT from the self-hosted Lakebase memory skill (agent-openai-memory). Use when: the agent should remember a user's preferences/facts/decisions across conversations; keywords 'long-term memory', 'managed memory', 'memory store', 'agentic memory'. OpenAI Agents SDK variant."
---

# Long-Term Memory — Databricks Managed Memory (UC memory-store)

Gives your agent **durable, cross-session memory** about each user via the Databricks **managed-memory**
APIs, exposed as five function tools (`save_memory`, `get_memory`, `list_memories`, `update_memory`,
`delete_memory`).

> ### This is Databricks *managed* memory — NOT the self-hosted Lakebase memory
> A memory store is a governed Unity Catalog securable you read/write purely over REST: **no database
> to provision, no tables to create (`store.setup()`), no embedding endpoint, and no extra Python
> dependency.** This is **different from** the `agent-openai-memory` / `agent-langgraph-memory` skills,
> which persist to a **Lakebase** instance you run yourself (`AsyncDatabricksSession` /
> `AsyncDatabricksStore`). Use **this** skill for governed, zero-infra long-term memory; use those for
> Lakebase-backed memory. (This is additive to the template's short-term Lakebase *session* memory,
> which still holds one conversation's history.)

> **SDK:** OpenAI Agents SDK (`@function_tool` + `RunContextWrapper`). For LangGraph, use the
> `managed-memory-store-langgraph` variant.

## Concepts

| Object | What it is |
|---|---|
| **Memory store** | A Unity Catalog securable `catalog.schema.name` (type `MEMORY_STORE`) — the governance object you grant on and the container for memories. Read/written via API (no SQL). |
| **Memory entry** | One memory: a markdown-ish `path` (e.g. `/memories/preferences/coffee.md`), a one-line `description`, and optional `contents`. |
| **Scope** | A string that partitions entries *within* a store — **the end user's id**. Decides whose memories you read/write. |

**Access is two separate questions:**
- *Can the caller use the store?* → a UC privilege on the **app service principal**: `READ_MEMORY_STORE` + `WRITE_MEMORY_STORE`. Memory tools always run **as the app SP** (locally, as the developer).
- *Whose memories?* → the explicit **`scope`** argument, set by your code to the end user's id.

The SP can see every scope, so **`scope` is your isolation boundary**: always set it to the end user, in trusted code, and **never let the model choose it**.

## Step 1 — set up the memory store (Setup Flow for Claude)

A memory store is a UC securable the agent reads/writes **as the app SP**; you (the developer) do this
control-plane setup **as yourself**, not from the app. First establish workspace creds:
`export DATABRICKS_HOST=<workspace-url>` and
`export TOKEN="$(databricks auth token -p <profile> | jq -r .access_token)"`.

**1a — choose or create the store.** Ask with **`AskUserQuestion`** (multi-choice):

> **"Do you have an existing memory store you can manage, or should I create one?"**
> - **Use an existing store** — you own it, or hold MANAGE / MANAGE_ACCESS_CONTROL on it.
> - **Create a new store** — I'll create one under a catalog + schema you choose; you become the owner (needs CREATE_MEMORY_STORE on that schema).

Then collect the details as **normal chat messages** (free-text — do NOT use `AskUserQuestion` for these):
- **Existing** → ask for the store's full **three-part name** `catalog.schema.name`; set `STORE` to it, then confirm it resolves: `bash examples/grant_memory_store.sh get` (a typo'd name otherwise only surfaces as `NOT_FOUND` at runtime).
- **Create** → ask for the **catalog**, the **schema**, and the **store name**, then create it (you become the owner):
  ```bash
  curl -X POST "$DATABRICKS_HOST/api/2.1/unity-catalog/memory-stores" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"<name>","catalog_name":"<catalog>","schema_name":"<schema>",
         "description":"Long-term memory for my agent"}'
  ```
  Set `STORE=<catalog>.<schema>.<name>`. (`bash examples/grant_memory_store.sh create` wraps this from `$STORE`.)

**1b — record it:** set the **same** env var `DATABRICKS_MEMORY_STORE=$STORE` in two places — `.env` (read locally — a fresh template ships only `.env.example`, so run `cp .env.example .env` first if you haven't run the **quickstart** skill) **and** `databricks.yml` under the app's `config.env` (the deployed app doesn't read `.env`):
```yaml
      config:
        env:
          - name: DATABRICKS_MEMORY_STORE
            value: "<catalog.schema.name>"
```

**1c — grant read+write** (requires you own / MANAGE_ACCESS_CONTROL the store):
```bash
export STORE=<catalog.schema.name>
APP_NAME=<your-app> bash examples/grant_memory_store.sh app   # deployed app's SP (run after deploy)
MY_USER=me@my-org.com bash examples/grant_memory_store.sh me  # your own user (for local testing)
bash examples/grant_memory_store.sh verify
```

> **DAB note:** Databricks Asset Bundles don't yet support a `MEMORY_STORE` securable grant, so the
> grant is the manual API call above (not `databricks.yml`). When DAB adds it, you'd declare a
> `uc_securable` grant (like Genie spaces / UC functions) and `bundle deploy` would apply it.

## Step 2 — add the tools

1. Copy `examples/utils_memory.py` into `agent_server/`. **No new dependency** — it uses the `databricks-sdk` and `openai-agents` already in the template.
2. Make three **additions** to the agent you already have in `agent_server/agent.py` — don't rewrite `create_agent` or drop anything it already passes (model, other tools, `mcp_servers`, …):
   - **Import:** `from agent_server.utils_memory import MEMORY_TOOLS, MemoryContext, resolve_scope`
   - **Append the tools** to the existing `tools=[...]` list: `tools=[*<your existing tools>, *MEMORY_TOOLS]`
   - **Set instructions:** `instructions=MEMORY_INSTRUCTIONS` (defined in Step 4 — add it before you import-test or you'll hit `NameError`; if the agent already has a prompt, merge rather than replace).

## Step 3 — resolve `scope` and wire it in (fail closed)

Resolve the end user **once per request** and pass it via the run context. The tools run as the app
SP; only `scope` is per-user. **Never** let scope be empty or fall back to the app identity — that
mixes all users into one bucket. This is purely **additive** to your handlers:

- **Import:** `from fastapi import HTTPException` and `from agent_server.utils_memory import resolve_scope, MemoryContext` (both already deps).
- **In each handler** (`invoke_handler` and `stream_handler`), add the fail-closed guard before the agent runs:
  ```python
  scope = resolve_scope()
  if not scope:
      raise HTTPException(status_code=401, detail="No end-user identity — refusing a shared memory scope.")
      # MLflow's agent_server surfaces this as a 500; either way the request is refused (fail closed).
  ```
- **Add `context=MemoryContext(scope=scope)` to the `Runner.run(...)` / `Runner.run_streamed(...)` call you already have** — keep every argument that's already there, just add one:
  ```python
  result = await Runner.run(agent, messages, context=MemoryContext(scope=scope))
  # If your handler already passes session= (e.g. the agent-openai-advanced template), KEEP it:
  result = await Runner.run(agent, messages, session=session, context=MemoryContext(scope=scope))
  ```

`resolve_scope()` (in `utils_memory.py`): deployed → the OBO forwarded token → `current_user.me().id`
(the proven path); local → an `X-Forwarded-User` header, or a dev-only `DATABRICKS_MEMORY_SCOPE` env
so the bundled chat UI works. Returns `None` when there's no end-user → you fail the request.

## Step 4 — agent instructions

Define `MEMORY_INSTRUCTIONS` near the top of `agent_server/agent.py` and pass it as `instructions=`
(Step 2). If the agent already has a system prompt, **prepend yours and keep it** rather than replacing it:

```python
MEMORY_INSTRUCTIONS = """You have durable, cross-session memory about this user — use it deliberately.

Recall before answering anything that could depend on the user (preferences, facts, past decisions,
projects, people): list_memories → pick the relevant path(s) by description → get_memory(path) to read
them, then answer only from what you read. A description is a label, not data — never state a remembered
fact you haven't just read, and don't invent paths. If nothing relevant is stored, say so instead of
guessing. Skip memory when the turn doesn't depend on the user; one list per turn.

Save what's durable (a stable preference, fact, decision, or ongoing project — not one-off chatter or
secrets): save_memory under a /memories/... path, checking the list first so you update_memory an
existing topic rather than duplicate it. update_memory to revise, delete_memory to remove stale/duplicate
entries. Briefly tell the user after you save, update, or delete."""
```

## Test locally

No forwarded headers exist locally, so simulate users by injecting the header (a plain string — fake
any id, no real token needed). Grant your own user first (Step 1c).

```bash
curl localhost:8000/invocations -H 'Content-Type: application/json' \
  -H 'X-Forwarded-User: alice' \
  -d '{"input":[{"role":"user","content":"Remember I am allergic to peanuts."}]}'
# same header on a new request -> recalls; a different X-Forwarded-User sees nothing (isolation).
```

### Test the deployed app

Deployed, `scope` comes from the real OBO token automatically (no `X-Forwarded-User` needed). Use an
OAuth token — **PATs don't work for Apps**:

```bash
TOKEN=$(databricks auth token --host <workspace-url> | jq -r .access_token)
curl -X POST https://<app-url>/invocations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"input":[{"role":"user","content":"What do you remember about me?"}]}'
```

## Limits & errors (beta)

- **Path:** must start with `/memories/`, ≤1024 chars, no whitespace/control chars/empty segments/trailing `/`. Re-creating an existing path → `ALREADY_EXISTS` (use `update_memory`).
- **Search:** not registered as a tool (recall is `list_memories` → `get_memory`). V1 search is an O(N) case-insensitive keyword scan; `top_k` defaults to 10, capped at 50. The function is kept in `utils_memory.py` for when semantic search lands.
- **List/Search volume:** at most ~5000 entries per `(store, scope)` are returned, with no "more" signal yet — fine until a single scope grows large.
- **Update:** `str_replace.old_str` must match exactly once or you get `INVALID_PARAMETER_VALUE` — have the agent re-read with `get_memory` and retry with more surrounding text. Update edits **contents only**, not the description.
- **Retryable vs not:** `ABORTED` = concurrent-write conflict, safe to retry. `INVALID_PARAMETER_VALUE` / `NOT_FOUND` / `ALREADY_EXISTS` = fix the input.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `RuntimeError: DATABRICKS_MEMORY_STORE is not set` | env var missing | Set it in `.env` (local) and `databricks.yml` `config.env` (deploy) — Step 1b |
| `500` + "No end-user identity" | no `scope` resolved — the fail-closed guard fired (the `agent_server` framework surfaces the 401 as a 500) | Deployed: ensure the OBO user token reaches the app. Local: send `X-Forwarded-User` or set `DATABRICKS_MEMORY_SCOPE` |
| `PERMISSION_DENIED` | caller lacks `READ/WRITE_MEMORY_STORE` | Grant the app SP (Step 1c `app`) / your user (Step 1c `me`) |
| `NOT_FOUND` on **every** call | wrong store name / store doesn't exist | Re-check `DATABRICKS_MEMORY_STORE` is the full `catalog.schema.name` and the store exists |
| `ALREADY_EXISTS` on save | the path is taken | Use `update_memory`, or pick a fresh path |
| `INVALID_PARAMETER_VALUE` on update | `str_replace.old_str` didn't match exactly once | `get_memory` to re-read, retry with more surrounding text, or use `replace_all` |
| Agent doesn't recall across turns | different `scope` per request, or it answered from a description it didn't `get_memory` | Use a consistent end-user id; instructions enforce `list → get` before stating facts |
| Transient `5xx` / `DEADLINE_EXCEEDED` | beta infra hiccup (control-plane) | Safe to retry the call |

## Notes / open considerations

- **No memory structure yet:** entries are flat per scope; the agent invents `/memories/...` paths. The list endpoint supports a `path_prefix` filter, but it's only useful once there's structure — it is **not** exposed to the agent here.
- **Description vs contents:** for a brief fact the `description` is the whole memory (leave `contents` empty); use `contents` only for detail beyond one line. `update_memory` revises contents only (updating descriptions isn't supported yet).
- **Combining with short-term memory:** this skill is additive to a template that already has short-term *session* memory (e.g. `agent-openai-advanced`'s Lakebase `AsyncDatabricksSession`). Keep it — pass `session=` **and** `context=` together (Step 3) — and after deploy also grant the app SP its Lakebase Postgres privileges (the template's own requirement, e.g. `scripts/grant_lakebase_permissions.py`), or the app 502s on session setup before memory ever runs.

## Next Steps

- Run locally: see **run-locally** skill.
- Deploy: see **deploy** skill (then run Step 1c `app` to grant the deployed SP).
