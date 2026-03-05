# appkit-genie

A Databricks App powered by [AppKit](https://databricks.github.io/appkit/), featuring React, TypeScript, and Tailwind CSS.

**Enabled plugins:**
- **Server** -- Express HTTP server with static file serving and Vite dev mode

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI (for deployment)
- Access to a Databricks workspace

## Databricks Authentication

### Local Development

For local development, configure your environment variables by creating a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set the environment variables you need:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_APP_PORT=8000
# ... other environment variables, depending on the plugins you use
```

### CLI Authentication

The Databricks CLI requires authentication to deploy and manage apps. Configure authentication using one of these methods:

#### OAuth U2M

Interactive browser-based authentication with short-lived tokens:

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

This will open your browser to complete authentication. The CLI saves credentials to `~/.databrickscfg`.

#### Configuration Profiles

Use multiple profiles for different workspaces:

```ini
[DEFAULT]
host = https://dev-workspace.cloud.databricks.com

[production]
host = https://prod-workspace.cloud.databricks.com
client_id = prod-client-id
client_secret = prod-client-secret
```

Deploy using a specific profile:

```bash
databricks bundle deploy --profile production
```

**Note:** Personal Access Tokens (PATs) are legacy authentication. OAuth is strongly recommended for better security.

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

Run the app in development mode with hot reload:

```bash
npm run dev
```

The app will be available at the URL shown in the console output.

### Build

Build both client and server for production:

```bash
npm run build
```

This creates:

- `dist/server.js` - Compiled server bundle
- `client/dist/` - Bundled client assets

### Production

Run the production build:

```bash
npm start
```

## Code Quality

There are a few commands to help you with code quality:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:fix
```

## Deployment with Databricks Asset Bundles

### 1. Configure Bundle

Update `databricks.yml` with your workspace settings:

```yaml
targets:
  default:
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

### 2. Validate Bundle

```bash
databricks bundle validate
```

### 3. Deploy

Deploy to the default target:

```bash
databricks bundle deploy
```

### 4. Run

Start the deployed app:

```bash
databricks bundle run <APP_NAME> -t dev
```

### Deploy to Production

1. Configure the production target in `databricks.yml`
2. Deploy to production:

```bash
databricks bundle deploy -t prod
```

## Project Structure

```
* client/          # React frontend
  * src/           # Source code
  * public/        # Static assets
* server/          # Express backend
  * server.ts      # Server entry point
  * routes/        # Routes
* shared/          # Shared types
* databricks.yml   # Bundle configuration
* app.yaml         # App configuration
* .env.example     # Environment variables example
```

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: React.js, TypeScript, Vite, Tailwind CSS, React Router
- **UI Components**: Radix UI, shadcn/ui
- **Databricks**: AppKit SDK
