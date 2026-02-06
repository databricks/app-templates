/**
 * MLflow-compatible /invocations endpoint for ResponsesAgent
 * Implements the Responses API format for compatibility with external clients
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { ChatSDKError } from '@chat-template/core/errors';
import { getAgent } from './chat';
import { langchainEventsToResponsesStream } from '../lib/responses-api-helpers';

export const invocationsRouter = Router();

// Apply auth middleware
invocationsRouter.use(authMiddleware);

/**
 * Responses API Request Schema
 * Based on https://mlflow.org/docs/latest/genai/serving/responses-agent/
 */
const responsesRequestSchema = z.object({
  input: z.array(
    z.union([
      // Simple message format
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
      // Output item format (for function calls, etc.)
      z.object({
        type: z.string(),
      }).passthrough(),
    ])
  ),
  stream: z.boolean().optional().default(true),
  custom_inputs: z.record(z.any()).optional(),
  context: z.object({
    conversation_id: z.string().optional(),
    user_id: z.string().optional(),
  }).optional(),
});

type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

/**
 * POST /invocations
 *
 * MLflow-compatible endpoint that accepts Responses API requests and returns
 * Responses API formatted responses (streaming or non-streaming).
 *
 * Request format:
 * {
 *   "input": [{ "role": "user", "content": "Hello" }],
 *   "stream": true
 * }
 *
 * Streaming response format (SSE):
 * data: {"type":"response.output_text.delta","item_id":"123","delta":"Hello"}
 * data: {"type":"response.output_item.done","item":{"type":"message",...}}
 * data: {"type":"response.completed"}
 */
invocationsRouter.post('/', async (req: Request, res: Response) => {
  try {
    console.log('[Invocations] Received request');

    // Parse and validate request
    const body = responsesRequestSchema.parse(req.body);
    const { input, stream = true } = body;

    // Extract user input from messages
    const userMessages = input.filter(msg => 'role' in msg && msg.role === 'user');
    if (userMessages.length === 0) {
      throw new ChatSDKError({
        code: 'bad_request:input',
        message: 'No user messages found in input',
      });
    }

    const lastUserMessage = userMessages[userMessages.length - 1];
    if (!('content' in lastUserMessage)) {
      throw new ChatSDKError({
        code: 'bad_request:input',
        message: 'Last user message has no content',
      });
    }

    const userInput = lastUserMessage.content as string;

    // Extract chat history (previous messages)
    const chatHistory = input
      .filter(msg => 'role' in msg && (msg.role === 'user' || msg.role === 'assistant'))
      .slice(0, -1) // Exclude the last message (current user input)
      .map(msg => ({
        role: (msg as any).role as 'user' | 'assistant',
        content: (msg as any).content as string,
      }));

    // Get the agent
    const agent = await getAgent();
    console.log('[Invocations] Agent initialized');

    if (stream) {
      // Set up SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Stream events from LangChain agent
      const eventStream = agent.streamEvents(
        {
          input: userInput,
          chat_history: chatHistory,
        },
        { version: 'v2' }
      );

      // Convert to Responses API format and stream
      try {
        for await (const responsesEvent of langchainEventsToResponsesStream(eventStream)) {
          const eventData = JSON.stringify(responsesEvent);
          res.write(`data: ${eventData}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamError) {
        console.error('[Invocations] Stream error:', streamError);
        const errorEvent = {
          type: 'error',
          error: {
            message: streamError instanceof Error ? streamError.message : 'Stream error',
            code: 'stream_error',
          },
        };
        res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming mode - collect all output items
      const outputItems: any[] = [];

      const eventStream = agent.streamEvents(
        {
          input: userInput,
          chat_history: chatHistory,
        },
        { version: 'v2' }
      );

      for await (const responsesEvent of langchainEventsToResponsesStream(eventStream)) {
        // Collect output_item.done events
        if (responsesEvent.type === 'response.output_item.done') {
          outputItems.push((responsesEvent as any).item);
        }
      }

      // Return complete response
      res.json({
        output: outputItems,
      });
    }
  } catch (error) {
    console.error('[Invocations] Error:', error);

    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request format',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
