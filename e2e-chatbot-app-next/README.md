<a href="https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app">
  <h1 align="center">Databricks Agent Chat Template</h1>
</a>

<p align="center">
    A chat application template for interacting with Databricks Agent Serving endpoints, built with ExpressJS, React, Vercel AI SDK, Databricks authentication, and optional Lakebase (database) integration.
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
- **Persistent Chat History (Optional)**: Leverages Databricks Lakebase (Postgres) for storing conversations, with governance and tight lakehouse integration. Can also run in ephemeral mode without database.

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
3. **Specify serving endpoint and address TODOs in databricks.yml**: Address the TODOs in `databricks.yml`, setting the default value of `serving_endpoint_name` to the name of the custom code agent or Agent Bricks endpoint to chat with. The optional TODOs wil allow you to deploy a Lakebase database bound to your application, which will allow for chat history to be persisted.

   **Tip:** To automatically configure and deploy with database support, run `./scripts/quickstart.sh` and select "Yes" when prompted about enabling persistent chat history. See [Database Configuration](#database-modes) for details.

   - NOTE: if using [Agent Bricks Multi-Agent Supervisor](https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor), you need to additionally grant the app service principal the `CAN_QUERY` permission on the underlying agent(s) that the MAS orchestrates. You can do this by adding those
     agent serving endpoints as resources in `databricks.yml` (see the NOTE in `databricks.yml` on this)
4. **Validate the bundle configuration**:

   ```bash
   databricks bundle validate
   ```

5. **Deploy the bundle**. The first deployment may take several minutes for provisioning resources (especially if database is enabled), but subsequent deployments are fast:

   ```bash
   databricks bundle deploy
   ```

   This creates:

   - **App resource** ready to start
   - **Lakebase database instance** (only if database resource is uncommented)

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

### Quick Start (Recommended)

Use our automated quickstart script for the fastest setup experience:

1. **Clone the repository**:

   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app-next
   ```

2. **Run the quickstart script**:

   ```bash
   ./scripts/quickstart.sh
   ```

   The quickstart script will:
   - **Install prerequisites** - Automatically installs jq, nvm, Node.js 20, and Databricks CLI
   - **Configure authentication** - Helps you select or create a Databricks CLI profile
   - **Set up serving endpoint** - Prompts for your endpoint name and validates it exists
   - **Database setup (optional)** - Choose persistent chat history or ephemeral mode
   - **Deploy to Databricks (optional)** - Optionally deploys resources and provisions database
   - **Configure local environment** - Automatically creates and populates .env
   - **Run migrations** - Sets up database schema if database is enabled

   The script handles the entire setup process automatically, including waiting for database provisioning and configuring connection details.

3. **Start the application**:

   Use the convenience script:
   ```bash
   ./scripts/start-app.sh
   ```

   Or manually:
   ```bash
   npm install  # Install/update dependencies
   npm run dev  # Start development server
   ```

   The app starts on [localhost:3000](http://localhost:3000) (frontend) and [localhost:3001](http://localhost:3001) (backend)

   **Tip:** The `start-app.sh` script is useful for quickly starting the app after initial setup, as it ensures dependencies are up-to-date before starting the dev server.

### Manual Setup (Alternative)

If you prefer to configure the environment manually:

1. **Clone and install**:

   ```bash
   git clone https://github.com/databricks/app-templates
   cd e2e-chatbot-app-next
   npm install
   ```

2. **Set up environment variables**:

   ```bash
   cp .env.example .env
   ```

   Address the TODOs in `.env`, specifying your Databricks CLI profile and database connection details.

3. **Run the application**:

   ```bash
   npm run dev
   ```

   The app starts on [localhost:3000](http://localhost:3000)

### Database Modes

The application supports two operating modes:

#### Persistent Mode (with Database)

This is the default mode when database environment variables are configured. In this mode:

- Chat conversations are saved to Postgres/Lakebase
- Users can access their chat history via the sidebar
- Conversations persist across sessions
- A database connection is required (POSTGRES_URL or PGDATABASE env vars)

#### Ephemeral Mode (without Database)

The application can also run without a database. In this mode:

- Chat conversations work normally but are **not saved**
- The sidebar shows "No chat history available"
- A small "Ephemeral" indicator appears in the header
- Users can still have conversations with the AI, but history is lost on page refresh

#### Selecting a Database Mode

The application will default to "Ephemeral mode" when no database environment variables are set.
To run in persistent mode, ensure your environment contains the following database variables:

```bash
# Useful for local development
POSTGRES_URL=...

# OR

# Handled for you when using Databricks Apps
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
PGHOST=...
```

The app will detect the absence or precense of database configuration and automatically run in the correct mode.

#### Enabling Database After Installation

If you initially installed the template without database support (ephemeral mode) and want to add persistent chat history later, you can re-run the quickstart script:

```bash
./scripts/quickstart.sh
```

When prompted about enabling persistent chat history, select "Yes". The script will:
- Uncomment the required database sections in `databricks.yml`
- Optionally deploy the Lakebase database instance
- Configure your `.env` file with database connection details
- Run database migrations if the database is provisioned
- Set up your local environment with the correct database settings

The script handles all configuration automatically, including:
- Detecting your Databricks workspace and authentication
- Calculating the correct database instance name for your target environment
- Retrieving the database host (PGHOST) after provisioning
- Updating environment variables with the correct values

**Manual Steps (Alternative):**

If you prefer to enable the database manually:

1. **Edit `databricks.yml`** - Uncomment both database sections:
   - Database instance resource (`chatbot_lakebase`) around line 18
   - Database resource binding (`- name: database`) around line 41

2. **Deploy the database**:
   ```bash
   databricks bundle deploy
   ```
   (First deployment takes several minutes for provisioning)

3. **Configure `.env`** with database variables:
   ```bash
   PGUSER=your-databricks-username
   PGHOST=your-postgres-host  # Get with: ./scripts/get-pghost.sh
   PGDATABASE=databricks_postgres
   PGPORT=5432
   ```

4. **Run database migrations**:
   ```bash
   npm run db:migrate
   ```

## Testing

The project uses Playwright for end-to-end testing and supports dual-mode testing to verify behavior in both persistent and ephemeral modes.

### Test Modes

Tests run in two separate modes to ensure both database and non-database functionality work correctly:

#### With Database Mode

- Uses database environment variables (either set in .env or declared elsewhere)
- Includes full Postgres database
- Tests chat history persistence, pagination, and deletion
- Will throw a warning and stop if no database exists

#### Ephemeral Mode

- No database connection (all POSTGRES_URL and PG\* variables omitted)
- Tests chat streaming without persistence
- Ensures UI gracefully handles missing database

### Running Tests

**Run all tests (both modes sequentially)**:

```bash
npm test
```

This runs with-db tests first, then ephemeral tests. The server automatically restarts between modes with different configurations.

**Run specific mode**:

```bash
# Test with database only
npm run test:with-db

# Test ephemeral mode only
npm run test:ephemeral
```

### Continuous Integration

The GitHub Actions workflow runs both test modes in separate jobs:

- **test-with-db**: Includes Postgres service, runs migrations, executes with-db tests
- **test-ephemeral**: No Postgres, no migrations, executes ephemeral tests

Both jobs run in parallel for faster CI feedback.

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
