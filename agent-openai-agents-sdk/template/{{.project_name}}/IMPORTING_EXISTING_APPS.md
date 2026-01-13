# Importing Existing Apps into Databricks Bundles

This guide explains how to import existing Databricks Apps (created via UI or other methods) into your bundle configuration, allowing you to manage them as Infrastructure as Code.

## When to Import an Existing App

You need to import an app when:
- You created an app through the Databricks UI
- An app was created by another tool or script
- You're adopting bundle-based deployment for an existing app
- You want to sync the state between your bundle and a deployed app

**Benefits of importing:**
- Version control your app configuration
- Deploy updates using `databricks bundle deploy`
- Track changes in git
- Ensure bundle and workspace stay in sync

## Prerequisites

1. **Databricks CLI** installed and configured
2. **Existing app** deployed in your workspace
3. **Bundle project** set up locally (if not, initialize one first)

## Step-by-Step: Import an Existing App

### 1. Find Your App's Details

First, get your app's name and ID from the workspace:

```bash
# List all apps in your workspace
databricks apps list --profile <profile-name>

# Get specific app details
databricks apps get <app-name> --profile <profile-name> --output json
```

Note the app's:
- **name** (e.g., `my-existing-agent`)
- **id** (UUID format)
- **url**

### 2. Add App to Your Bundle Configuration

Create or update `databricks.yml` to include the app:

```yaml
bundle:
  name: my_project

resources:
  apps:
    my_agent:  # Resource identifier (can be different from app name)
      name: "my-existing-agent"  # Actual app name in workspace
      description: "My existing agent app"
      source_code_path: ./

targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

**Important:** The app `name` field must match the existing app's name in the workspace.

### 3. Bind the Bundle Resource to the Existing App

Use the `bundle deployment bind` command to link your bundle resource to the existing app:

```bash
# Syntax: databricks bundle deployment bind <resource-key> <resource-id>
databricks bundle deployment bind my_agent <app-id> --profile <profile-name>
```

**Example:**
```bash
databricks bundle deployment bind my_agent 6cab529f-fb30-42ba-8b63-dd7b2ea71ed9 --profile DEFAULT
```

You'll see a confirmation prompt:

```
The following resource will be bound:
  app:my_agent -> 6cab529f-fb30-42ba-8b63-dd7b2ea71ed9

Updates to these resources will be made in the workspace upon the next deploy. Proceed? [y/n]: y
```

Type `y` to confirm the binding.

### 4. Verify the Binding

After binding, your next `bundle deploy` will update the existing app based on your bundle configuration:

```bash
# Deploy will now update the existing app
databricks bundle deploy --profile <profile-name>
```

**What happens:**
- ✅ The existing app in the workspace will be updated with your bundle configuration
- ✅ Future deploys will sync your local config to the workspace
- ✅ The binding is stored in `.databricks/bundle/<target>/terraform/terraform.tfstate`

### 5. View Bound Resources

Check which resources are bound in your deployment:

```bash
# See deployment summary
databricks bundle summary --profile <profile-name>
```

## Unbinding an App

To remove the link between a bundle resource and its workspace counterpart:

```bash
databricks bundle deployment unbind <resource-key> --profile <profile-name>
```

**Example:**
```bash
databricks bundle deployment unbind my_agent --profile DEFAULT
```

**What happens after unbinding:**
- The app continues to exist in the workspace
- Bundle deploys will no longer affect this app
- You can re-bind later or manage it separately

## Complete Workflow Example

### Scenario: You created an app via UI, now want to manage it via bundles

**1. Check the existing app:**
```bash
$ databricks apps list --profile DEFAULT
NAME              URL
my-ui-agent      https://my-ui-agent-123.aws.databricksapps.com

$ databricks apps get my-ui-agent --profile DEFAULT --output json | jq '{id, name, url}'
{
  "id": "abc12345-6789-0def-1234-567890abcdef",
  "name": "my-ui-agent",
  "url": "https://my-ui-agent-123.aws.databricksapps.com"
}
```

**2. Create bundle project (if needed):**
```bash
databricks bundle init ~/app-templates/agent-openai-agents-sdk
cd my_project
```

**3. Update `databricks.yml`:**
```yaml
bundle:
  name: my_project

resources:
  apps:
    ui_agent:  # Resource key
      name: "my-ui-agent"  # Must match existing app name
      description: "Agent created via UI"
      source_code_path: ./

targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

**4. Bind the resource:**
```bash
$ databricks bundle deployment bind ui_agent abc12345-6789-0def-1234-567890abcdef --profile DEFAULT

The following resource will be bound:
  app:ui_agent -> abc12345-6789-0def-1234-567890abcdef

Updates to these resources will be made in the workspace upon the next deploy. Proceed? [y/n]: y
✓ Resource bound successfully
```

**5. Deploy changes:**
```bash
$ databricks bundle deploy --profile DEFAULT
Uploading bundle files...
Deploying resources...
✓ Deployment complete!
```

Now your UI-created app is managed via bundles!

## Binding Other Resources

The `bundle deployment bind` command works for all Databricks resources managed in bundles:

### Jobs
```bash
databricks bundle deployment bind my_job 1234567890
```

### Pipelines
```bash
databricks bundle deployment bind my_pipeline 9876543210
```

### Experiments (when supported)
```bash
databricks bundle deployment bind my_experiment 1234567890123456
```

## Best Practices

1. **Always bind before modifying** - Bind existing resources before making changes in your bundle to avoid creating duplicates

2. **Use descriptive resource keys** - Choose clear resource identifiers in `databricks.yml` (e.g., `production_agent`, `staging_app`)

3. **Document bindings** - Add comments in `databricks.yml` noting when resources were bound from existing deployments

4. **Check state files** - The binding info is stored in `.databricks/bundle/<target>/terraform/terraform.tfstate` - commit this to version control

5. **Test in dev first** - Always test bind/deploy workflow in a dev environment before applying to production

## Troubleshooting

### "Resource not found"
- Verify the resource ID is correct
- Check you're using the right profile/workspace
- Ensure the resource exists: `databricks apps get <app-name>`

### "Resource already bound"
- The resource is already linked to another bundle
- Unbind it first, or use a different bundle

### "Permission denied"
- Ensure you have appropriate permissions on the resource
- Check your authentication: `databricks current-user me`

### Deploy overwrites unexpected changes
- Review what changed: `databricks bundle deploy --dry-run`
- The bundle configuration will take precedence over workspace state

## Additional Resources

- [Databricks Bundle Commands](https://docs.databricks.com/dev-tools/cli/bundle-commands)
- [Bundle Deployment Reference](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands#bind)
- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
