import { Router, type Request, type Response } from 'express';
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  generateText,
  type LanguageModelUsage,
  createUIMessageStreamResponse,
} from 'ai';
import { authMiddleware, requireAuth } from '../middleware/auth';
import {
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  updateChatVisiblityById,
} from '../shared/databricks/db/queries';
import { convertToUIMessages, generateUUID } from '../shared/lib/utils';
import { myProvider } from '../shared/lib/ai/providers';
import { entitlementsByUserType } from '../shared/lib/ai/entitlements';
import {
  postRequestBodySchema,
  type PostRequestBody,
} from '../shared/lib/schemas/chat';
import { ChatSDKError } from '../shared/lib/errors';
import type { ChatMessage } from '../shared/lib/types';
import type { ChatModel } from '../shared/lib/ai/models';
import type { VisibilityType } from '../shared/lib/types';
import {
  DATABRICKS_TOOL_CALL_ID,
  DATABRICKS_TOOL_DEFINITION,
} from '../shared/databricks/providers/databricks-provider/databricks-tool-calling';
import { streamCache } from '../shared/lib/stream-cache';
import type { UserType } from '../shared/databricks/auth/databricks-auth';

export const chatRouter = Router();

// Apply auth middleware to all chat routes
chatRouter.use(authMiddleware);

/**
 * POST /api/chat - Send a message and get streaming response
 */
chatRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  console.log(`CHAT POST REQUEST ${Date.now()}`);

  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(req.body);
  } catch (_) {
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
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }
    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      const error = new ChatSDKError('rate_limit:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({ message });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        const error = new ChatSDKError('forbidden:chat');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

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

    // Clear any previous active stream for this chat
    streamCache.clearActiveStream(id);

    let finalUsage: LanguageModelUsage | undefined;
    const streamId = generateUUID();

    const model = await myProvider.languageModel(selectedChatModel);
    const result = streamText({
      model,
      messages: convertToModelMessages(uiMessages),
      onFinish: ({ usage }) => {
        finalUsage = usage;
      },
      tools: {
        [DATABRICKS_TOOL_CALL_ID]: DATABRICKS_TOOL_DEFINITION,
      },
    });

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
              console.error(
                'Stack trace:',
                error instanceof Error ? error.stack : 'No stack',
              );

              const errorMessage =
                error instanceof Error
                  ? error.message
                  : 'Oops, an error occurred!';

              writer.write({
                type: 'data-error',
                data: errorMessage,
              });

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
              context: finalUsage,
            });
          } catch (err) {
            console.warn('Unable to persist last usage for chat', id, err);
          }
        }

        streamCache.clearActiveStream(id);
      },
    });

    // Create the Web API Response with the stream
    const webResponse = createUIMessageStreamResponse({
      stream,
      consumeSseStream({ stream }) {
        streamCache.storeStream({
          streamId,
          chatId: id,
          stream,
        });
      },
    });

    // Pipe the Web API ReadableStream into Express response
    if (webResponse.body) {
      const reader = webResponse.body.getReader();

      // Read and write chunks to Express response
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (error) {
          console.error('Stream pumping error:', error);
          res.end();
        }
      };

      pump();
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.error('Unhandled error in chat API:', error);
    console.error(
      'Stack trace:',
      error instanceof Error ? error.stack : 'No stack available',
    );

    const chatError = new ChatSDKError('offline:chat');
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

/**
 * DELETE /api/chat?id=:id - Delete a chat
 */
chatRouter.delete('/', requireAuth, async (req: Request, res: Response) => {
  const id = req.query.id as string;

  if (!id) {
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  const session = req.session;
  if (!session) {
    const error = new ChatSDKError('unauthorized:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    const error = new ChatSDKError('forbidden:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  const deletedChat = await deleteChatById({ id });
  return res.status(200).json(deletedChat);
});

/**
 * GET /api/chat/:id/stream - Resume a stream
 */
chatRouter.get(
  '/:id/stream',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const cursor = Number.parseInt(
      (req.headers['x-resume-stream-cursor'] as string) || '0',
    );

    const cachedStream = streamCache.getStream(id);

    if (!cachedStream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const reader = cachedStream.getReader();
      let currentCursor = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Only send chunks after the cursor position
        if (currentCursor >= cursor) {
          res.write(`data: ${JSON.stringify(value)}\n\n`);
        }
        currentCursor++;
      }
    } finally {
      res.end();
    }
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
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
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
  message: any;
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
