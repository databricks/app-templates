# Agent Load Testing

This directory contains tools for load testing Databricks Apps to find their maximum QPS (queries per second).

## Directory Structure

- `mock-agent-app/` — Mock agent app (based on `agent-openai-agents-sdk`) with `MockAsyncOpenAI` client
- `load-test-scripts/` — Load testing scripts (`run_load_test.py`, `locustfile.py`, `dashboard_template.py`)
- `load-test-runs/` — Test results (one subdirectory per run, each with dashboard + CSV data)

## Skills

Use `/load-testing` for an interactive walkthrough of the full load testing workflow.
