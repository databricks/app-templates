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

// pgvector may already be installed in a schema other than `public` (CREATE
// EXTENSION installs into the creator's first search_path schema), where the
// unqualified `vector` type and `<=>` operator don't resolve. Look up where it
// lives and qualify both with that schema.
const VECTOR_SCHEMA_SQL = `
  SELECT quote_ident(n.nspname) AS schema,
         has_schema_privilege(n.oid, 'USAGE') AS usable
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector'
`;

// Quoted identifier of the schema pgvector is installed in; set by setupRagTables.
let vectorSchema = 'public';

const createDocumentsTableSql = (schema: string) => `
  CREATE TABLE IF NOT EXISTS rag.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding ${schema}.vector(1024),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function resolveVectorSchema(appkit: AppKitWithLakebase): Promise<string> {
  const { rows } = await appkit.lakebase.query(VECTOR_SCHEMA_SQL);
  if (rows.length === 0) {
    throw new Error(
      '[rag] The pgvector extension is not installed and this app could not create it. ' +
        'Run `CREATE EXTENSION vector SCHEMA public;` in the Lakebase database as a role that can.'
    );
  }
  const { schema, usable } = rows[0] as { schema: string; usable: boolean };
  if (!usable) {
    throw new Error(
      `[rag] pgvector is installed in schema ${schema}, which this app's role cannot use. ` +
        `Grant access (\`GRANT USAGE ON SCHEMA ${schema} TO <app service principal>;\`) ` +
        'or reinstall pgvector in `public`.'
    );
  }
  return schema;
}

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
  vectorSchema = await resolveVectorSchema(appkit);
  const { rows } = await appkit.lakebase.query(DOCUMENTS_TABLE_EXISTS_SQL);
  if (rows.length > 0) return;
  await appkit.lakebase.query(SETUP_RAG_SCHEMA_SQL);
  await appkit.lakebase.query(createDocumentsTableSql(vectorSchema));
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
     VALUES ($1, $2::${vectorSchema}.vector, $3)
     RETURNING id, content, metadata, created_at`,
    [input.content, JSON.stringify(input.embedding), JSON.stringify(input.metadata ?? {})]
  );
  return result.rows[0];
}

export async function retrieveSimilar(appkit: AppKitWithLakebase, queryEmbedding: number[], limit = 5) {
  const result = await appkit.lakebase.query(
    `SELECT id, content, metadata,
            1 - (embedding OPERATOR(${vectorSchema}.<=>) $1::${vectorSchema}.vector) AS similarity
     FROM rag.documents
     WHERE embedding IS NOT NULL
     ORDER BY embedding OPERATOR(${vectorSchema}.<=>) $1::${vectorSchema}.vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit]
  );
  return result.rows;
}
