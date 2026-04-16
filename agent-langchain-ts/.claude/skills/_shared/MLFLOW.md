# MLflow Tracing

All agent interactions are automatically traced to MLflow for debugging and evaluation.

## View Traces

1. Navigate to your Databricks workspace
2. Go to Experiments
3. Find experiment: `/Users/<username>/agent-langchain-ts`
4. Click on runs to see traces with:
   - Input/output messages
   - Tool calls and results
   - Latency metrics
   - Token usage
   - Error details

## Configuration

Set in `.env`:
```bash
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=<your-experiment-id>
```

Or set environment variables in `databricks.yml`:
```yaml
resources:
  apps:
    agent_langchain_ts:
      config:
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value: "{{var.mlflow_experiment_id}}"
```

## Troubleshooting

**Traces not appearing:**
- Check `MLFLOW_EXPERIMENT_ID` is set
- Verify experiment exists in workspace
- Check app logs for tracing errors: `databricks apps logs <app-name> | grep -i trace`
