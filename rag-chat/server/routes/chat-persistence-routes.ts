import type { Application } from 'express';
import { listChats, createChat, getChatForUser, getChatMessages, appendMessage, deleteChat } from '../lib/chat-store';
import { authenticateUser } from '../lib/auth';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

export function setupChatPersistenceRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.get('/api/chats', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      try {
        const chats = await listChats(appkit, userId);
        res.json(chats);
      } catch (err) {
        console.error('[chats:list]', (err as Error).message);
        res.status(500).json({ error: 'Failed to list chats' });
      }
    });

    app.post('/api/chats', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      try {
        const { title } = req.body as { title?: string };
        const chat = await createChat(appkit, { userId, title: title || 'New Chat' });
        res.status(201).json(chat);
      } catch (err) {
        console.error('[chats:create]', (err as Error).message);
        res.status(500).json({ error: 'Failed to create chat' });
      }
    });

    app.get('/api/chats/:id/messages', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      try {
        const chat = await getChatForUser(appkit, req.params.id, userId);
        if (!chat) {
          res.status(404).json({ error: 'Chat not found' });
          return;
        }
        const messages = await getChatMessages(appkit, req.params.id, userId);
        res.json(messages);
      } catch (err) {
        console.error('[chats:messages]', (err as Error).message);
        res.status(500).json({ error: 'Failed to load messages' });
      }
    });

    app.delete('/api/chats/:id', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      try {
        const deleted = await deleteChat(appkit, req.params.id, userId);
        if (!deleted) {
          res.status(404).json({ error: 'Chat not found' });
          return;
        }
        res.status(204).end();
      } catch (err) {
        console.error('[chats:delete]', (err as Error).message);
        res.status(500).json({ error: 'Failed to delete chat' });
      }
    });

    app.post('/api/chats/:id/messages', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;
      try {
        const chat = await getChatForUser(appkit, req.params.id, userId);
        if (!chat) {
          res.status(404).json({ error: 'Chat not found' });
          return;
        }
        const { role, content } = req.body as { role: string; content: string };
        const message = await appendMessage(appkit, { chatId: req.params.id, userId, role, content });
        res.status(201).json(message);
      } catch (err) {
        console.error('[chats:save-message]', (err as Error).message);
        res.status(500).json({ error: 'Failed to save message' });
      }
    });
  });
}
