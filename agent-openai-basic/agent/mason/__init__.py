"""Plumbing that will move into Databricks SDKs later (databricks-openai and friends).

Nothing here is meant to be edited to build an agent — it's the durable session store, MLflow
tracing setup, and the Responses<->agent-SDK wire translation. Grouped in one place so the
migration to SDK-provided equivalents is a localized change. Edit the agent in ``agent/agent.py``
and ``agent/tools/`` instead.
"""
