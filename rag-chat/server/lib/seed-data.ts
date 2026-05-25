import type { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const WIKIPEDIA_ARTICLES = [
  'Databricks',
  'Apache_Spark',
  'Delta_Lake_(software)',
  'Apache_Iceberg',
  'Data_lakehouse',
  'Apache_Parquet',
  'Extract,_transform,_load',
  'Retrieval-augmented_generation',
  'Data_lake',
];

const SHOULD_RESEED = process.env.RAG_RESEED === 'true';

async function fetchWikipediaArticle(title: string): Promise<string> {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', format: 'json', titles: title });
  const res = await fetch(url);
  const data = (await res.json()) as { query: { pages: Record<string, { extract?: string }> } };
  const page = Object.values(data.query.pages)[0];
  return page.extract ?? '';
}

function chunkText(text: string, maxLen = 1000): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 50);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    if (cur.length + p.length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += p + '\n\n';
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export async function seedFromWikipedia(
  appkit: AppKitWithLakebase,
  generateEmbedding: (text: string) => Promise<number[]>,
  insertDocument: (
    appkit: AppKitWithLakebase,
    input: { content: string; embedding: number[]; metadata?: Record<string, unknown> }
  ) => Promise<Record<string, unknown>>
) {
  const { rows } = await appkit.lakebase.query('SELECT COUNT(*) as count FROM rag.documents');
  const existingCount = parseInt(String(rows[0].count), 10);
  if (existingCount > 0 && !SHOULD_RESEED) return;
  if (existingCount > 0 && SHOULD_RESEED) {
    await appkit.lakebase.query('DELETE FROM rag.documents');
  }
  for (const title of WIKIPEDIA_ARTICLES) {
    try {
      const chunks = chunkText(await fetchWikipediaArticle(title));
      for (const [index, chunk] of chunks.entries()) {
        await insertDocument(appkit, {
          content: chunk,
          embedding: await generateEmbedding(chunk),
          metadata: { source: 'wikipedia', article: title, chunkIndex: index },
        });
      }
    } catch (err) {
      console.warn(`[seed] ${title} failed:`, (err as Error).message);
    }
  }
}
