# Model Serving to Databricks Apps Migration

This template helps migrate MLflow ResponsesAgent deployments from Databricks Model Serving to Databricks Apps.

## Getting Started

When a user asks to migrate an agent, **use the `migrate-from-model-serving` skill** which contains the complete step-by-step migration guide.

The skill will guide you through:
1. Gathering user inputs (Databricks profile, app name, sync vs async preference)
2. Downloading the original agent artifacts from Model Serving
3. Analyzing and understanding the agent code
4. Migrating the code to the Apps format (`@invoke`/`@stream` decorators)
5. Setting up and configuring the app
6. Testing locally
7. Deploying to Databricks Apps

## Quick Reference

**Key Transformation:**
- **From:** `ResponsesAgent` class with `predict()`/`predict_stream()` methods
- **To:** Functions with `@invoke()` and `@stream()` decorators (sync or async, based on user preference)

**Scaffold Files:**
All scaffold template files are already in this directory. The migration skill will copy these to a new app directory.

## Available Skills

- **migrate-from-model-serving** - Complete migration guide (use this!)
- **quickstart** - Set up local development environment
- **run-locally** - Start the agent server locally
- **deploy** - Deploy to Databricks Apps
