<a href="https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app">
  <h1 align="center">Databricks Agent Chat Template</h1>
</a>

<p align="center">
    A chat application template for interacting with Databricks Agent Serving endpoints, built with ExpressJS, React, Vercel AI SDK, and Databricks authentication.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running Locally</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>
<br/>

This template provides a fully functional chat app for custom code agents and Agent Bricks deployed on Databricks,
but has some [known limitations](#known-limitations) for other use cases. Work is in progress on addressing these limitations.

## Features

- **Databricks Agent and Foundation Model Integration**: Direct connection to Databricks Agent serving endpoints and Agent Bricks
- **Databricks Authentication**: Uses Databricks authentication to identify end users of the chat app and securely manage their conversations.
- **Persistent Chat History**: Leverages Databricks Lakebase (Postgres) for storing conversations, with governance and tight lakehouse integration.

## Prerequisites

1. **Databricks serving endpoint**: you need access to a Databricks workspace containing the Agent Bricks or custom agent serving endpoint to chat with.
2. **Set up Databricks authentication**
   - Install the latest version of the [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html). On macOS, do this via:
   ```bash
   brew install databricks
   brew upgrade databricks && databricks -v
   ```
   - Run the following to configure authentication.
     In the snippet below, `DATABRICKS_CONFIG_PROFILE` is the name of the Databricks CLI profile under which to configure
     authentication. If desired, you can update this to a name of your choice, e.g. `dev_workspace`.
   ```bash
     export DATABRICKS_CONFIG_PROFILE='chatbot_template'
     databricks auth login --profile "$DATABRICKS_CONFIG_PROFILE"
   ```

## Deployment

This project includes a [Databricks Asset Bundle (DAB)](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial) configuration that simplifies deployment by automatically creating and managing all required resources.

1. **Clone the repo**:
   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app-next
   ```
2. **Databricks authentication**: Ensure auth is configured as described in [Prerequisites](#prerequisites).
3. **Specify serving endpoint and address TODOs in databricks.yml**: Address the TODOs in `databricks.yml`, setting the default value of `serving_endpoint_name` to the name of the custom code agent or Agent Bricks endpoint to chat with.
   - NOTE: if using [Agent Bricks Multi-Agent Supervisor](https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor), you need to additionally grant the app service principal the `CAN_QUERY` permission on the underlying agent(s) that the MAS orchestrates. You can do this by adding those
     agent serving endpoints as resources in `databricks.yml` (see the NOTE in `databricks.yml` on this)
4. **Validate the bundle configuration**:

   ```bash
   databricks bundle validate
   ```

5. **Deploy the bundle** (creates Lakebase instance and app). The first deployment may take several minutes for provisioning resources, but subsequent deployments are fast:

   ```bash
   databricks bundle deploy
   ```

   This creates:

   - **Lakebase database instance** for persisting chat history
   - **App resource** ready to start

6. **Start the app**:

   ```bash
   databricks bundle run databricks_chatbot
   ```

7. **View deployment summary** (useful for debugging deployment issues):
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

- No support for image or other multi-modal inputs
- The most common and officially recommended authentication methods for Databricks are supported: Databricks CLI auth for local development, and Databricks service principal auth for deployed apps. Other authentication mechanisms (PAT, Azure MSI, etc) are not currently supported.
- We create one database per app, because the app code targets a fixed `ai_chatbot` schema within the database instance. To host multiple apps out of the same instance, you can:
  - Update the database instance name in `databricks.yml`
  - Update references to `ai_chatbot` in the codebase to your new desired schema name within the existing database instance
  - Run `npm run db:generate` to regenerate database migrations
  - Deploy your app

## Troubleshooting

### "reference does not exist" errors when running databricks bundle CLI commands

If you get an error like the following (or other similar "reference does not exist" errors)
while running `databricks bundle` commands, your Databricks CLI version may be out of date.
Make sure to install the latest version of the Databricks CLI (per [Prerequisites](#prerequisites)) and try again.

```bash
$ databricks bundle deploy
Error: reference does not exist: ${workspace.current_user.domain_friendly_name}

Name: databricks-chatbot
Target: dev
Workspace:
  User: user@company.com
  Path: /Workspace/Users/user@company.com/.bundle/databricks-chatbot/dev
```

### "Resource not found" errors during databricks bundle deploy

Errors like the following one can occur when attempting to deploy the app if the state of your bundle does not match the state of resources
deployed in your workspace:

```bash
$ databricks bundle deploy
Uploading bundle files to /Workspace/Users/user@company.com/.bundle/databricks-chatbot/dev/files...
Deploying resources...
Error: terraform apply: exit status 1

Error: failed to update database_instance

  with databricks_database_instance.chatbot_lakebase,
  on bundle.tf.json line 45, in resource.databricks_database_instance.chatbot_lakebase:
  45:       }

Resource not found


Updating deployment state...
```

This can happen if resources deployed via your bundle were then manually deleted, or resources specified by your bundle
were manually created without using the `databricks bundle` CLI. To resolve this class of issue, inspect the state of the actual deployed resources
in your workspace and compare it to the bundle state using `databricks bundle summary`. If there is a mismatch,
[see docs](https://docs.databricks.com/aws/en/dev-tools/bundles/faqs#can-i-port-existing-jobs-pipelines-dashboards-and-other-databricks-objects-into-my-bundle) on how to
manually bind (if resources were manually created) or unbind (if resources were manually deleted) resources
from your current bundle state. In the above example, the `chatbot_lakebase` database instance resource
was deployed via `databricks bundle deploy`, and then manually deleted. This broke subsequent deployments of the bundle
(because bundle state indicated the resource should exist, but it did not in the workspace). Running `databricks bundle unbind chatbot_lakebase` updated bundle state to reflect the deletion of the instance,
unblocking subsequent deployment of the bundle via `databricks bundle deploy`.
