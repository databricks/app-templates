import { pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { getChatForUser } from '../lib/chat-store';
import { authenticateUser } from '../lib/auth';
import { setRagContext, startRagRequest, type AppKitRagContext } from '../lib/tracing';

export function setupChatRoutes(appkit: AppKitRagContext) {
  setRagContext(appkit);
  appkit.server.extend((app) => {
    app.post('/api/chat', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      const { messages, chatId } = req.body as {
        messages: UIMessage[];
        chatId?: string;
      };
      if (!chatId) {
        res.status(400).json({ error: 'chatId is required' });
        return;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages are required' });
        return;
      }
      const chat = await getChatForUser(appkit, chatId, userId);
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      try {
        const response = await startRagRequest({
          messages,
          chatId,
          userId,
          requestId: req.header('x-request-id') || randomUUID(),
        });
        res.setHeader('X-MLflow-Trace-Id', response.traceId);
        pipeUIMessageStreamToResponse({ stream: response.stream, response: res });
      } catch (error) {
        console.error('[chat]', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) res.status(502).json({ error: 'Chat request failed' });
      }
    });
  });
}
