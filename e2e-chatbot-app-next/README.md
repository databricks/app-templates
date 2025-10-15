<a href="https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app">
  <h1 align="center">Databricks Agent Chat Template</h1>
</a>

<p align="center">
    A chat application template for interacting with Databricks Agent Serving endpoints, built with Next.js, Vercel AI SDK, and Databricks authentication.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running Locally</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>
<br/>


This template is based on the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) template, with Databricks-specific enhancements
for authenticating to agents and database instances on Databricks.

For additional documentation and details, see the [original repository](https://github.com/vercel/ai-chatbot/blob/main/README.md).

**NOTE**: this template provides a fully functional chat app for custom code agents and Agent Bricks deployed on Databricks,
but has some [known limitations](#known-limitations) for other use cases. Work is in progress on addressing these limitations.

## Features

- **Databricks Agent and Foundation Model Integration**: Direct connection to Databricks Agent serving endpoints and Agent Bricks
- **Databricks Authentication**: Uses Databricks authentication to identify end users of the chat app and securely manage their conversations.
- **Persistent Chat History**: Leverages Databricks Lakebase (Postgres) for storing conversations, with governance and tight lakehouse integration.

## Prerequisites

1. **Databricks serving endpoint**: you need access to a Databricks workspace containing the Agent Bricks or custom agent serving endpoint to chat with. 
2. **Set up Databricks authentication**
   - Install the [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html)
   - Run `export DATABRICKS_CONFIG_PROFILE='your_profile_name'`, replacing `your_profile_name` with the name of a CLI profile for configuring authentication
   - Run `databricks auth login --profile "$DATABRICKS_CONFIG_PROFILE"` to configure authentication for your workspace under the named profile
   

## Deployment

This project includes a [Databricks Asset Bundle (DAB)](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial) configuration that simplifies deployment by automatically creating and managing all required resources.

1. **Clone the repo**:
   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app-next
   ```
2. **Databricks authentication**: Ensure auth is configured as described in [Prerequisites](#prerequisites).
2. **Specify serving endpoint**: In `databricks.yml`, set the default value of `serving_endpoint_name` to the name of the custom code agent or Agent Bricks endpoint to chat with.
3. **Validate the bundle configuration**:
   ```bash
   databricks bundle validate
   ```

4. **Deploy the bundle** (creates Lakebase instance, database catalog, and app). The first deployment may take several minutes for provisioning resources, but subsequent deployments are fast:
   ```bash
   databricks bundle deploy
   ```

   This creates:
   - **Lakebase database instance** for persisting chat history
   - **App resource** ready to start

5. **Start the app**:
   ```bash
   databricks bundle run databricks_chatbot
   ```

6. **View deployment summary** (useful for debugging deployment issues):
   ```bash
   databricks bundle summary
   ```

### Deployment Targets

The bundle supports multiple environments:

- **dev** (default): Development environment
- **staging**: Staging environment for testing
- **prod**: Production environment

To deploy to a specific target:
```bash
databricks bundle deploy -t staging --var serving_endpoint_name="your-endpoint"
```

## Running Locally

**Before running the app locally, you should first deploy the app to Databricks following the steps 
in [Deployment](#deployment)**. This is the simplest way to get the required database instance set up with the correct permissions,
so that both you and your app service principal can connect to the database, with database migrations already applied.

### Setup Steps

1. **Clone and install**:
   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app-next
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env.local
   ```

   Address the TODOs in `.env.local`, specifying your Databricks CLI profile and database connection details. 

3. **Run the application**:
   ```bash
   npm run dev
   ```

   The app starts on [localhost:3000](http://localhost:3000)

## Known limitations
* No support for image or other multi-modal inputs
* The most common and officially recommended authentication methods for Databricks are supported: Databricks CLI auth for local development, and Databricks service principal auth for deployed apps. Other authentication mechanisms (PAT, Azure MSI, etc) are not currently supported.
* We create one database per app, because the app code targets a fixed `ai_chatbot` schema within the database instance. To host multiple apps out of the same instance, you can:
    * Update the database instance name in `databricks.yml`
    * Update references to `ai_chatbot` in the codebase to your new desired schema name within the existing database instance
    * Run `npm run db:generate` to regenerate database migrations
    * Deploy your app
