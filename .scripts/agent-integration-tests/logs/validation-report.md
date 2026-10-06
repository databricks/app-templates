# Template Deploy-Validation Report

**Composed from the full 48-template run (2026-10-06, profile `dogfood`, shared app
`template-e2e-test`) plus targeted re-verifications after fixes.** Deploy templates
are browser-verified with the saved SSO storageState (confirms the app's own content
renders, not the login page); build templates are `npm ci && npm run build`.

**30 passed · 0 unresolved failures · 18 skipped (16 OBO + 2 DAB-only)**

## ✅ Deployed & verified (30)

| Template | Mode | Verify | Note |
| --- | --- | --- | --- |
| streamlit-hello-world-app | deploy | html | |
| dash-hello-world-app | deploy | html | |
| flask-hello-world-app | deploy | html | |
| gradio-hello-world-app | deploy | html | |
| shiny-hello-world-app | deploy | html | **fixed**: Shiny Express run target, `--host/--port`, `shiny~=1.8.0`, `websockets~=13.0` |
| streamlit-chatbot-app | deploy | html | serving-endpoint |
| dash-chatbot-app | deploy | html | serving-endpoint |
| gradio-chatbot-app | deploy | html | serving-endpoint |
| shiny-chatbot-app | deploy | html | serving-endpoint |
| e2e-chatbot-app | deploy | html | reclassified build→html (Streamlit) |
| streamlit-data-app | deploy | html | sql-warehouse |
| dash-data-app | deploy | html | sql-warehouse |
| gradio-data-app | deploy | html | sql-warehouse |
| shiny-data-app | deploy | html | sql-warehouse |
| streamlit-postgres-app | deploy | html | postgres (Lakebase) |
| dash-postgres-app | deploy | html | postgres (Lakebase) |
| flask-postgres-app | deploy | html | postgres (Lakebase) |
| streamlit-database-app | deploy | html | database (Lakebase) |
| dash-database-app | deploy | html | database (Lakebase) |
| flask-database-app | deploy | html | database (Lakebase) |
| mcp-server-hello-world | deploy | mcp | |
| agent-langgraph | deploy | html | experiment + serving-endpoint, chat UI |
| agent-langgraph-advanced | deploy | html | + postgres |
| agent-openai-advanced | deploy | html | + postgres |
| agent-openai-agents-sdk | deploy | html | experiment + serving-endpoint, chat UI |
| agent-non-conversational | deploy | api | reclassified html→api (API-only, no chat UI) |
| agent-langchain-ts | build | build | |
| e2e-chatbot-app-next | build | build | |
| nodejs-fastapi-hello-world-app | build | build | **fixed**: build now uses the npm proxy |
| rag-chat | build | build | **fixed**: build now uses the npm proxy |

## ⏭ OBO — not testable in this environment (16)

These forward the end user's token (on-behalf-of). They need `user_api_scopes` +
user consent, which this automated environment can't provide.

`appkit-all-in-one`, `appkit-analytics`, `appkit-files`, `appkit-genie`,
`appkit-lakebase`, `appkit-serving`, `agentic-support-console`, `content-moderator`,
`inventory-intelligence`, `saas-tracker`, `vacation-rentals`,
`streamlit-data-app-obo-user`, `dash-data-app-obo-user`, `gradio-data-app-obo-user`,
`shiny-data-app-obo-user`, `mcp-server-open-api-spec` (`user_api_scopes: catalog.connections`)

## ⏭ DAB-only — not deployable via the shared-app source model (2)

No `app.yaml` (databricks.yml only), so a source-level deploy into the shared app
can't set their run command. Validate these via `databricks bundle deploy`.

`agent-migration-from-model-serving`, `agent-openai-agents-sdk-multiagent`

## Shared-app resource bindings used

`serving-endpoint` (claude-sonnet-5-5), `sql-warehouse`, `postgres` (Lakebase
Autoscaling), `database` (Lakebase), `genie-space`, `uc-volume`, `experiment` —
each granted to the app service principal `743e25a6-526a-4191-b7bb-5da636a490cf`.
