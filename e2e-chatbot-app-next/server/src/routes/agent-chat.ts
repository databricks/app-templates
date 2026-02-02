/**
 * Agent-powered chat endpoint using LangChain
 *
 * This extends the standard chat endpoint with LangChain agent capabilities,
 * including tool calling and MLflow tracing.
 */

import type { Request, Response, Router as RouterType } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { ChatSDKError, checkChatAccess } from '@chat-template/core';
import { isDatabaseAvailable, saveMessages, getMessagesByChatId, saveChat } from '@chat-template/db';
import { createAgent, invokeAgent } from '../agent/agent.js';
import { initializeMLflowTracing } from '../agent/tracing.js';

// Initialize MLflow tracing once
let tracingInitialized = false;
function ensureTracing() {
  if (!tracingInitialized) {
    try {
      initializeMLflowTracing({
        serviceName: 'chatbot-agent',
        experimentId: process.env.MLFLOW_EXPERIMENT_ID,
      });
      tracingInitialized = true;
    } catch (error) {
      console.warn('Failed to initialize MLflow tracing:', error);
    }
  }
}

// Request schema
const AgentChatRequestSchema = z.object({
  id: z.string(),
  message: z.string().optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(['private', 'public']).optional(),
});

export const agentChatRouter: RouterType = Router();

agentChatRouter.use(authMiddleware);

/**
 * POST /api/agent/chat
 *
 * Agent-powered chat with tool calling support
 */
agentChatRouter.post(
  '/',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const session = req.session!;
      const parsed = AgentChatRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parsed.error.issues,
        });
      }

      const { id, message, selectedChatModel, selectedVisibilityType } = parsed.data;

      // Ensure MLflow tracing is initialized
      ensureTracing();

      // Check chat access
      if (isDatabaseAvailable()) {
        const { allowed, reason } = await checkChatAccess(id, session.user.id);

        if (!allowed) {
          // Create new chat if it doesn't exist
          if (reason === 'not_found' && message) {
            await saveChat({
              id,
              userId: session.user.id,
              title: message.slice(0, 100),
              visibility: selectedVisibilityType || 'private',
            });
          } else {
            return res.status(403).json({
              error: 'Forbidden',
              message: reason || 'Access denied',
            });
          }
        }
      }

      // Get previous messages
      let previousMessages: Array<{ role: string; content: string }> = [];
      if (isDatabaseAvailable()) {
        const dbMessages = await getMessagesByChatId({ id });
        previousMessages = dbMessages.map((m) => {
          // Extract text content from parts
          const textContent = m.parts
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n') || '';

          return {
            role: m.role,
            content: textContent,
          };
        });
      }

      // Validate we have a message
      if (!message) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Message is required',
        });
      }

      // Save user message if database is available
      if (isDatabaseAvailable()) {
        await saveMessages({
          messages: [{
            id: `${Date.now()}-user`,
            chatId: id,
            role: 'user',
            parts: [{ type: 'text', text: message }],
            attachments: [],
            createdAt: new Date(),
          }],
        });
      }

      // Create agent with pre-configured tools (basic + Databricks SQL)
      const agent = await createAgent({
        model: selectedChatModel,
        temperature: 0.1,
        maxTokens: 2000,
        mcpConfig: {
          enableSql: true, // Enable Databricks SQL MCP tools by default
        },
      });

      // Invoke agent
      const result = await invokeAgent(agent, message, previousMessages);

      // Save assistant message if database is available
      if (isDatabaseAvailable()) {
        await saveMessages({
          messages: [{
            id: `${Date.now()}-assistant`,
            chatId: id,
            role: 'assistant',
            parts: [{ type: 'text', text: result.output }],
            attachments: [],
            createdAt: new Date(),
          }],
        });
      }

      // Return response
      res.json({
        message: {
          role: 'assistant',
          content: result.output,
        },
        intermediateSteps: result.intermediateSteps,
      });

    } catch (error) {
      console.error('Agent chat error:', error);

      if (error instanceof ChatSDKError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
        });
      }

      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);
