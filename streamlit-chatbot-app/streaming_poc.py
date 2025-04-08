from mlflow.deployments import get_deploy_client
c = get_deploy_client('databricks')
endpoint = "agents_smurching-default-vs_index_export"
# endpoint = "ep-gpt4o-newest"
for chunk in c.predict_stream(
    endpoint=endpoint,
    inputs={'messages': [{'role': 'user', 'content': 'Hello! What is 234234234*234234? After calculating that, tell me how to fix my overheating blender.'}]}
):
    print(chunk)
