import { getWorkspaceClient } from '@databricks/appkit';

const workspaceClient = getWorkspaceClient({});

export async function generateEmbedding(text: string): Promise<number[]> {
  const endpoint = process.env.DATABRICKS_EMBEDDING_ENDPOINT || 'databricks-gte-large-en';
  const result = await workspaceClient.servingEndpoints.query({
    name: endpoint,
    input: text,
  });
  return result.data![0].embedding!;
}
