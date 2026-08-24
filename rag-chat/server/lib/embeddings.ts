import { getWorkspaceClient } from '@databricks/appkit';

const workspaceClient = getWorkspaceClient({});

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: Record<string, unknown>;
}

export async function generateEmbeddingWithMetadata(text: string): Promise<EmbeddingResult> {
  const endpoint = process.env.DATABRICKS_EMBEDDING_ENDPOINT || 'databricks-gte-large-en';
  const result = await workspaceClient.servingEndpoints.query({
    name: endpoint,
    input: text,
  });
  const embedding = result.data?.[0]?.embedding;
  if (!embedding) throw new Error('Embedding endpoint returned no embedding');
  return {
    embedding,
    model: String((result as { model?: unknown }).model ?? endpoint),
    usage: ((result as { usage?: Record<string, unknown> }).usage as Record<string, unknown> | undefined) ?? {},
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return (await generateEmbeddingWithMetadata(text)).embedding;
}
