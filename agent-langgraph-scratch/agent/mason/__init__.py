"""Plumbing that will move into Databricks SDKs later (databricks-langchain and friends).

Nothing here is meant to be edited to build an agent — it's the session-store checkpointer, MLflow
tracing setup, MCP tool loading, and the Responses<->LangGraph wire translation. Grouped in one
place so the migration to SDK-provided equivalents is a localized change. Edit the agent in
``agent/agent.py`` and ``agent/tools/`` instead.
"""
