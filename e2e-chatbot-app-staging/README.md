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

This template is based on the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) with Databricks-specific integrations for agents/LLMs, authentication, and conversation history persistence.
For general features and additional documentation, see the [original repository](https://github.com/vercel/ai-chatbot/blob/main/README.md).

## Key Databricks Features

- **Databricks Agent and Foundation Model Integration**: Direct connection to Databricks Agent and Foundation Model serving endpoints
- **Databricks Authentication**: Uses Databricks authentication to identify end users of the chat app and securely manage their conversations.
- **Persistent Chat History**: Leverages Databricks Lakebase (Postgres) for storing conversations, with governance and tight lakehouse integration.

## Prerequisites

1. **Databricks workspace access**
2. **Create a database instance**:
   - [Create a lakebase instance](https://docs.databricks.com/aws/en/oltp/instances/create/) for persisting chat history.
3. **Set up Databricks authentication**
   - Install the [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html)
   - Run `databricks auth login [--profile name]` to configure authentication for your workspace, optionally under a named profile
   - Set the `DATABRICKS_CONFIG_PROFILE` environment variable to the name of the profile you created, or set it to "DEFAULT" if you didn't specify any profile name.


## Running Locally

### Setup Steps

1. **Clone and install**:
   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app
   pnpm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` with your credentials

3. **Run the application**:
   ```bash
   npm run dev
   ```

   Or using pnpm:
   ```bash
   pnpm dev
   ```

   The app starts on [localhost:3000](http://localhost:3000) and automatically:
   - Creates the database schema (`ai_chatbot`)
   - Runs all necessary migrations
   - Sets up OAuth token management

## Deployment


Set environment variables to specify the agent serving endpoint your app supports chatting with,
and the database instance in which to persist chat history:  

```bash
export SERVING_ENDPOINT="your-serving-endpoint-name"
export DATABASE_INSTANCE="your-database-instance-name"
```

Then, create the app:
```bash
databricks apps create --json '{
  "name": "my-agent-chatbot",
  "resources": [
    {
      "name": "serving-endpoint",
      "serving_endpoint": {
        "name": "'"$SERVING_ENDPOINT"'",
        "permission": "CAN_QUERY"
      }
    },
    {
        "name": "database",
        "database": {
            "instance_name": "'"$DATABASE_INSTANCE"'",
            "database_name": "databricks_postgres",
            "permission": "CAN_CONNECT_AND_CREATE"
         }
     }
  ]
}'
```

Upload the source code to Databricks and deploy the app by running the following commands from the e2e-chatbot-app directory:

```bash
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks sync . "/Users/$DATABRICKS_USERNAME/e2e-chatbot-app"
databricks apps deploy my-agent-chatbot --source-code-path "/Workspace/Users/$DATABRICKS_USERNAME/e2e-chatbot-app"
```
