import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  generateText,
  type LanguageModelUsage,
  pipeUIMessageStreamToResponse,
} from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';

// Convert ai's LanguageModelUsage to @ai-sdk/provider's LanguageModelV3Usage
function toV3Usage(usage: LanguageModelUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}
import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
  getIdFromRequest,
} from '../middleware/auth';
import { z } from 'zod';
import {
  deleteChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  updateChatVisiblityById,
  isDatabaseAvailable,
} from '@chat-template/db';
import {
  type ChatMessage,
  checkChatAccess,
  convertToUIMessages,
  generateUUID,
  myProvider,
  postRequestBodySchema,
  type PostRequestBody,
  StreamCache,
  type VisibilityType,
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';

export const chatRouter: RouterType = Router();

const streamCache = new StreamCache();

// Define tools in AI SDK format
const chatTools = {
  calculator: {
    description: 'Evaluate a mathematical expression. Supports basic arithmetic operations.',
    parameters: z.object({
      expression: z.string().describe('Mathematical expression to evaluate, e.g. "2 + 2 * 3"'),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        // eslint-disable-next-line no-eval
        const result = eval(expression);
        return `Result: ${result}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error evaluating expression: ${message}`;
      }
    },
  },
  get_weather: {
    description: 'Get the current weather conditions for a specific location',
    parameters: z.object({
      location: z.string().describe('The city and state, e.g. "San Francisco, CA"'),
    }),
    execute: async ({ location }: { location: string }) => {
      const conditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
      const temps = [65, 70, 75, 80];
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      const temp = temps[Math.floor(Math.random() * temps.length)];
      return `The weather in ${location} is ${condition} with a temperature of ${temp}°F`;
    },
  },
  get_current_time: {
    description: 'Get the current date and time in a specific timezone',
    parameters: z.object({
      timezone: z.string().optional().describe('IANA timezone name, e.g. "America/New_York", "Europe/London", defaults to UTC'),
    }),
    execute: async ({ timezone = 'UTC' }: { timezone?: string }) => {
      const now = new Date();
      return `Current time in ${timezone}: ${now.toLocaleString('en-US', { timeZone: timezone })}`;
    },
  },
  execute_sql_query: {
    description: 'Execute a SQL query on Databricks. Use this to query tables, catalogs, and schemas. Returns query results in JSON format.',
    parameters: z.object({
      query: z.string().describe('SQL query to execute, e.g. "SHOW CATALOGS" or "SELECT * FROM catalog.schema.table LIMIT 10"'),
      warehouse_id: z.string().optional().describe('SQL warehouse ID to use for execution. If not provided, uses default warehouse.'),
    }),
    execute: async ({ query, warehouse_id }: { query: string; warehouse_id?: string }) => {
      try {
        const host = process.env.DATABRICKS_HOST;
        const token = process.env.DATABRICKS_TOKEN || process.env.DATABRICKS_CLIENT_SECRET;

        if (!host || !token) {
          return 'Error: Databricks credentials not configured. Set DATABRICKS_HOST and DATABRICKS_TOKEN environment variables.';
        }

        const warehouseId = warehouse_id || process.env.DATABRICKS_WAREHOUSE_ID;
        if (!warehouseId) {
          return 'Error: No SQL warehouse ID provided. Set DATABRICKS_WAREHOUSE_ID environment variable or provide warehouse_id parameter.';
        }

        // Execute SQL statement using Statement Execution API
        const response = await fetch(`${host}/api/2.0/sql/statements`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            statement: query,
            warehouse_id: warehouseId,
            wait_timeout: '30s',
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          return `Error executing query: ${response.status} ${response.statusText} - ${error}`;
        }

        const result = await response.json();

        // Check if query completed successfully
        if (result.status?.state === 'SUCCEEDED') {
          // Format results
          const data = result.result?.data_array || [];
          const columns = result.manifest?.schema?.columns?.map((col: any) => col.name) || [];

          if (data.length === 0) {
            return 'Query executed successfully but returned no rows.';
          }

          // Return formatted results
          return JSON.stringify({
            columns,
            rows: data,
            row_count: data.length,
          }, null, 2);
        } else if (result.status?.state === 'FAILED') {
          return `Query failed: ${result.status?.error?.message || 'Unknown error'}`;
        } else {
          return `Query is in ${result.status?.state} state`;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error executing SQL query: ${message}`;
      }
    },
  },
  list_catalogs: {
    description: 'List all available Databricks Unity Catalog catalogs',
    parameters: z.object({}),
    execute: async () => {
      try {
        const host = process.env.DATABRICKS_HOST;
        const token = process.env.DATABRICKS_TOKEN || process.env.DATABRICKS_CLIENT_SECRET;

        if (!host || !token) {
          return 'Error: Databricks credentials not configured.';
        }

        const response = await fetch(`${host}/api/2.1/unity-catalog/catalogs`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          return `Error listing catalogs: ${response.status} ${response.statusText}`;
        }

        const result = await response.json();
        const catalogs = result.catalogs?.map((cat: any) => cat.name) || [];
        return `Available catalogs: ${catalogs.join(', ')}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error listing catalogs: ${message}`;
      }
    },
  },
  list_schemas: {
    description: 'List all schemas in a specific Databricks catalog',
    parameters: z.object({
      catalog: z.string().describe('Name of the catalog to list schemas from'),
    }),
    execute: async ({ catalog }: { catalog: string }) => {
      try {
        const host = process.env.DATABRICKS_HOST;
        const token = process.env.DATABRICKS_TOKEN || process.env.DATABRICKS_CLIENT_SECRET;

        if (!host || !token) {
          return 'Error: Databricks credentials not configured.';
        }

        const response = await fetch(`${host}/api/2.1/unity-catalog/schemas?catalog_name=${catalog}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          return `Error listing schemas: ${response.status} ${response.statusText}`;
        }

        const result = await response.json();
        const schemas = result.schemas?.map((schema: any) => schema.name) || [];
        return `Schemas in ${catalog}: ${schemas.join(', ')}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error listing schemas: ${message}`;
      }
    },
  },
  list_tables: {
    description: 'List all tables in a specific schema',
    parameters: z.object({
      catalog: z.string().describe('Name of the catalog'),
      schema: z.string().describe('Name of the schema'),
    }),
    execute: async ({ catalog, schema }: { catalog: string; schema: string }) => {
      try {
        const host = process.env.DATABRICKS_HOST;
        const token = process.env.DATABRICKS_TOKEN || process.env.DATABRICKS_CLIENT_SECRET;

        if (!host || !token) {
          return 'Error: Databricks credentials not configured.';
        }

        const response = await fetch(`${host}/api/2.1/unity-catalog/tables?catalog_name=${catalog}&schema_name=${schema}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          return `Error listing tables: ${response.status} ${response.statusText}`;
        }

        const result = await response.json();
        const tables = result.tables?.map((table: any) => table.name) || [];
        return `Tables in ${catalog}.${schema}: ${tables.join(', ')}`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error listing tables: ${message}`;
      }
    },
  },
};

// Apply auth middleware to all chat routes
chatRouter.use(authMiddleware);

/**
 * POST /api/chat - Send a message and get streaming response
 *
 * Note: Works in ephemeral mode when database is disabled.
 * Streaming continues normally, but no chat/message persistence occurs.
 */
chatRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const dbAvailable = isDatabaseAvailable();
  if (!dbAvailable) {
    console.log('[Chat] Running in ephemeral mode - no persistence');
  }

  console.log(`CHAT POST REQUEST ${Date.now()}`);

  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(req.body);
  } catch (_) {
    console.error('Error parsing request body:', _);
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message?: ChatMessage;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { chat, allowed, reason } = await checkChatAccess(
      id,
      session?.user.id,
    );

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (!chat) {
      // Only create new chat if we have a message (not a continuation)
      if (isDatabaseAvailable() && message) {
        const title = await generateTitleFromUserMessage({ message });

        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      }
    } else {
      if (chat.userId !== session.user.id) {
        const error = new ChatSDKError('forbidden:chat');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });

    // Use previousMessages from request body when:
    // 1. Ephemeral mode (DB not available) - always use client-side messages
    // 2. Continuation request (no message) - tool results only exist client-side
    const useClientMessages =
      !dbAvailable || (!message && requestBody.previousMessages);
    const previousMessages = useClientMessages
      ? (requestBody.previousMessages ?? [])
      : convertToUIMessages(messagesFromDb);

    // If message is provided, add it to the list and save it
    // If not (continuation/regeneration), just use previous messages
    let uiMessages: ChatMessage[];
    if (message) {
      uiMessages = [...previousMessages, message];
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: 'user',
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    } else {
      // Continuation: use existing messages without adding new user message
      uiMessages = previousMessages as ChatMessage[];

      // For continuations with database enabled, save any updated assistant messages
      // This ensures tool-result parts (like MCP approval responses) are persisted
      if (dbAvailable && requestBody.previousMessages) {
        const assistantMessages = requestBody.previousMessages.filter(
          (m: ChatMessage) => m.role === 'assistant',
        );
        if (assistantMessages.length > 0) {
          await saveMessages({
            messages: assistantMessages.map((m: ChatMessage) => ({
              chatId: id,
              id: m.id,
              role: m.role,
              parts: m.parts,
              attachments: [],
              createdAt: m.metadata?.createdAt
                ? new Date(m.metadata.createdAt)
                : new Date(),
            })),
          });

          // Check if this is an MCP denial - if so, we're done (no need to call LLM)
          // Denial is indicated by a dynamic-tool part with state 'output-denied'
          // or with approval.approved === false
          const hasMcpDenial = requestBody.previousMessages?.some(
            (m: ChatMessage) =>
              m.parts?.some(
                (p) =>
                  p.type === 'dynamic-tool' &&
                  (p.state === 'output-denied' ||
                    ('approval' in p &&
                      (p.approval)?.approved ===
                        false)),
              ),
          );

          if (hasMcpDenial) {
            // We don't need to call the LLM because the user has denied the tool call
            res.end();
            return;
          }
        }
      }
    }

    // Clear any previous active stream for this chat
    streamCache.clearActiveStream(id);

    let finalUsage: LanguageModelUsage | undefined;
    const streamId = generateUUID();

    const model = await myProvider.languageModel(selectedChatModel);
    const result = streamText({
      model,
      messages: await convertToModelMessages(uiMessages),
      tools: chatTools,
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: id,
        [CONTEXT_HEADER_USER_ID]: session.user.email ?? session.user.id,
      },
      onFinish: ({ usage }) => {
        finalUsage = usage;
      },
    });

    /**
     * We manually create the stream to have access to the stream writer.
     * This allows us to inject custom stream parts like data-error.
     */
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.merge(
          result.toUIMessageStream({
            originalMessages: uiMessages,
            generateMessageId: generateUUID,
            sendReasoning: true,
            sendSources: true,
            onError: (error) => {
              console.error('Stream error:', error);

              const errorMessage =
                error instanceof Error ? error.message : JSON.stringify(error);

              writer.write({ type: 'data-error', data: errorMessage });

              return errorMessage;
            },
          }),
        );
      },
      onFinish: async ({ responseMessage }) => {
        console.log(
          'Finished message stream! Saving message...',
          JSON.stringify(responseMessage, null, 2),
        );
        await saveMessages({
          messages: [
            {
              id: responseMessage.id,
              role: responseMessage.role,
              parts: responseMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            },
          ],
        });

        if (finalUsage) {
          try {
            await updateChatLastContextById({
              chatId: id,
              context: toV3Usage(finalUsage),
            });
          } catch (err) {
            console.warn('Unable to persist last usage for chat', id, err);
          }
        }

        streamCache.clearActiveStream(id);
      },
    });

    pipeUIMessageStreamToResponse({
      stream,
      response: res,
      consumeSseStream({ stream }) {
        streamCache.storeStream({
          streamId,
          chatId: id,
          stream,
        });
      },
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.error('Unhandled error in chat API:', error);

    const chatError = new ChatSDKError('offline:chat');
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

/**
 * DELETE /api/chat?id=:id - Delete a chat
 */
chatRouter.delete(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const deletedChat = await deleteChatById({ id });
    return res.status(200).json(deletedChat);
  },
);

/**
 * GET /api/chat/:id
 */

chatRouter.get(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const { chat } = await checkChatAccess(id, req.session?.user.id);

    return res.status(200).json(chat);
  },
);

/**
 * GET /api/chat/:id/stream - Resume a stream
 */
chatRouter.get(
  '/:id/stream',
  [requireAuth],
  async (req: Request, res: Response) => {
    const chatId = getIdFromRequest(req);
    if (!chatId) return;
    const cursor = req.headers['x-resume-stream-cursor'] as string;

    console.log(`[Stream Resume] Cursor: ${cursor}`);

    console.log(`[Stream Resume] GET request for chat ${chatId}`);

    // Check if there's an active stream for this chat first
    const streamId = streamCache.getActiveStreamId(chatId);

    if (!streamId) {
      console.log(`[Stream Resume] No active stream for chat ${chatId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { allowed, reason } = await checkChatAccess(
      chatId,
      req.session?.user.id,
    );

    // If chat doesn't exist in DB, it's a temporary chat from the homepage - allow it
    if (reason === 'not_found') {
      console.log(
        `[Stream Resume] Resuming stream for temporary chat ${chatId} (not yet in DB)`,
      );
    } else if (!allowed) {
      console.log(
        `[Stream Resume] User ${req.session?.user.id} does not have access to chat ${chatId} (reason: ${reason})`,
      );
      const streamError = new ChatSDKError('forbidden:chat', reason);
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get all cached chunks for this stream
    const stream = streamCache.getStream(streamId, {
      cursor: cursor ? Number.parseInt(cursor) : undefined,
    });

    if (!stream) {
      console.log(`[Stream Resume] No stream found for ${streamId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.log(`[Stream Resume] Resuming stream ${streamId}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the cached stream directly to the response
    stream.pipe(res);

    // Handle stream errors
    stream.on('error', (error) => {
      console.error('[Stream Resume] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
  },
);

/**
 * POST /api/chat/title - Generate title from message
 */
chatRouter.post('/title', requireAuth, async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const title = await generateTitleFromUserMessage({ message });
    res.json({ title });
  } catch (error) {
    console.error('Error generating title:', error);
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

/**
 * PATCH /api/chat/:id/visibility - Update chat visibility
 */
chatRouter.patch(
  '/:id/visibility',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      const id = getIdFromRequest(req);
      if (!id) return;
      const { visibility } = req.body;

      if (!visibility || !['public', 'private'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility type' });
      }

      await updateChatVisiblityById({ chatId: id, visibility });
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating visibility:', error);
      res.status(500).json({ error: 'Failed to update visibility' });
    }
  },
);

// Helper function to generate title from user message
async function generateTitleFromUserMessage({
  message,
}: {
  message: ChatMessage;
}) {
  const model = await myProvider.languageModel('title-model');
  const { text: title } = await generateText({
    model,
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons. do not include other expository content ("I'll help...")`,
    prompt: JSON.stringify(message),
  });

  return title;
}
