import { createOpenAI } from '@ai-sdk/openai';
import { streamText, createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { Config } from '@databricks/sdk-experimental';
import type { Application } from 'express';
import { generateEmbedding } from '../lib/embeddings';
import { retrieveSimilar } from '../lib/rag-store';
import { getChatForUser, appendMessage } from '../lib/chat-store';
import { authenticateUser } from '../lib/auth';

interface AppKitWithLakebase {
  lakebase: { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
  server: { extend(fn: (app: Application) => void): void };
}

interface RagSource {
  index: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

async function getDatabricksToken() {
  if (process.env.DATABRICKS_TOKEN) return process.env.DATABRICKS_TOKEN;
  const config = new Config({ profile: process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT' });
  await config.ensureResolved();
  const headers = new Headers();
  await config.authenticate(headers);
  const authHeader = headers.get('Authorization');
  if (!authHeader) throw new Error('Failed to get Databricks token. Check your CLI profile or set DATABRICKS_TOKEN.');
  return authHeader.replace('Bearer ', '');
}

export function setupChatRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.post('/api/chat', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;

      const { messages, chatId } = req.body as { messages: UIMessage[]; chatId?: string };

      if (!chatId) {
        res.status(400).json({ error: 'chatId is required' });
        return;
      }
      const chat = await getChatForUser(appkit, chatId, userId);
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }

      const coreMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content:
          m.parts
            ?.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('') ?? '',
      }));

      try {
        const lastUserMsg = coreMessages.filter((m) => m.role === 'user').pop();
        if (lastUserMsg) {
          await appendMessage(appkit, { chatId, userId, role: 'user', content: lastUserMsg.content });
        }

        // Single retrieval pass, reused for both the system prompt and the
        // UI stream that the client renders as "Retrieved context".
        let sources: RagSource[] = [];
        let contextPrefix = '';
        if (lastUserMsg) {
          const embedding = await generateEmbedding(lastUserMsg.content);
          const similar = await retrieveSimilar(appkit, embedding, 5);
          sources = similar.map((d: Record<string, unknown>, i: number) => ({
            index: i + 1,
            content: d.content as string,
            similarity: d.similarity as number,
            metadata: d.metadata as Record<string, unknown>,
          }));
          if (similar.length > 0) {
            contextPrefix =
              'Use the following context to inform your answer. If not relevant, say so.\n\n' +
              similar.map((d: Record<string, unknown>, i: number) => `[${i + 1}] ${d.content}`).join('\n\n');
          }
        }

        const augmented = [
          ...(contextPrefix ? [{ role: 'system' as const, content: contextPrefix }] : []),
          ...coreMessages,
        ];

        const token = await getDatabricksToken();
        const endpoint = process.env.DATABRICKS_ENDPOINT || 'databricks-gpt-5-4-mini';
        const databricks = createOpenAI({
          baseURL: `https://${process.env.DATABRICKS_WORKSPACE_ID}.ai-gateway.cloud.databricks.com/mlflow/v1`,
          apiKey: token,
        });

        const stream = createUIMessageStream({
          execute: ({ writer }) => {
            if (sources.length > 0) {
              writer.write({ type: 'data-sources', data: sources, transient: false });
            }
            const result = streamText({
              model: databricks.chat(endpoint),
              messages: augmented,
              maxOutputTokens: 1000,
              onFinish: async ({ text }) => {
                await appendMessage(appkit, { chatId, userId, role: 'assistant', content: text });
              },
            });
            writer.merge(result.toUIMessageStream());
          },
        });

        pipeUIMessageStreamToResponse({ stream, response: res });
      } catch (err) {
        console.error('[chat]', (err as Error).message);
        if (!res.headersSent) res.status(502).json({ error: 'Chat request failed' });
      }
    });
  });
}
