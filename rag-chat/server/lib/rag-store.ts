import type { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const DOCUMENTS_TABLE_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'rag' AND table_name = 'documents'
`;

const SETUP_RAG_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS rag`;

const CREATE_DOCUMENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS rag.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding VECTOR(1024),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

export async function setupRagTables(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === '42501') {
      console.log('[rag] Skipping extension creation — insufficient privileges (likely already exists)');
    } else {
      throw err;
    }
  }
  const { rows } = await appkit.lakebase.query(DOCUMENTS_TABLE_EXISTS_SQL);
  if (rows.length > 0) return;
  await appkit.lakebase.query(SETUP_RAG_SCHEMA_SQL);
  await appkit.lakebase.query(CREATE_DOCUMENTS_TABLE_SQL);
}

export async function insertDocument(
  appkit: AppKitWithLakebase,
  input: {
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }
) {
  const result = await appkit.lakebase.query(
    `INSERT INTO rag.documents (content, embedding, metadata)
     VALUES ($1, $2::vector, $3)
     RETURNING id, content, metadata, created_at`,
    [input.content, JSON.stringify(input.embedding), JSON.stringify(input.metadata ?? {})]
  );
  return result.rows[0];
}

export async function retrieveSimilar(appkit: AppKitWithLakebase, queryEmbedding: number[], limit = 5) {
  const result = await appkit.lakebase.query(
    `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS similarity
     FROM rag.documents
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit]
  );
  return result.rows;
}
