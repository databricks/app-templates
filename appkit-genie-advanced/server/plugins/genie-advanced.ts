import {
  Plugin,
  getExecutionContext,
  toPlugin,
  type BasePluginConfig,
  type IAppRouter,
  type PluginManifest,
} from '@databricks/appkit';
import type express from 'express';

function workspaceClient() {
  return getExecutionContext().client;
}

interface GenieProConfig extends BasePluginConfig {
  spaces?: Record<string, string>;
}

const manifest = {
  name: 'genieAdvanced',
  displayName: 'Genie Advanced Plugin',
  description:
    'Extended Genie endpoints: list spaces, list conversations, message feedback, and JSON query results for CSV export.',
  resources: { required: [], optional: [] },
} satisfies PluginManifest<'genieAdvanced'>;

class GenieProPlugin extends Plugin<GenieProConfig> {
  static manifest = manifest;

  private spaces: Record<string, string> = {};

  setup() {
    this.spaces = resolveSpaces(this.config.spaces);
    return Promise.resolve();
  }

  injectRoutes(router: IAppRouter) {
    this.route(router, {
      name: 'listSpaces',
      method: 'get',
      path: '/spaces',
      handler: async (req, res) => {
        await this.asUser(req)._listSpaces(req, res);
      },
    });
    this.route(router, {
      name: 'listConversations',
      method: 'get',
      path: '/spaces/:alias/conversations',
      handler: async (req, res) => {
        await this.asUser(req)._listConversations(req, res);
      },
    });
    this.route(router, {
      name: 'attachmentQueryResult',
      method: 'get',
      path: '/spaces/:alias/conversations/:conversationId/messages/:messageId/attachments/:attachmentId/result',
      handler: async (req, res) => {
        await this.asUser(req)._attachmentQueryResult(req, res);
      },
    });
    this.route(router, {
      name: 'sendFeedback',
      method: 'post',
      path: '/spaces/:alias/conversations/:conversationId/messages/:messageId/feedback',
      handler: async (req, res) => {
        await this.asUser(req)._sendFeedback(req, res);
      },
    });
  }

  exports() {
    return {
      listSpaces: () => this._collectSpaces(),
    };
  }

  async _listSpaces(_req: express.Request, res: express.Response) {
    try {
      const result = await this._collectSpaces();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  }

  async _collectSpaces() {
    const ws = workspaceClient();
    const entries = await Promise.all(
      Object.entries(this.spaces).map(async ([alias, spaceId]) => {
        try {
          const space = await ws.genie.getSpace({ space_id: spaceId });
          return {
            alias,
            space_id: spaceId,
            title: space.title,
            description: space.description,
            warehouse_id: space.warehouse_id,
            accessible: true,
          };
        } catch (err) {
          return {
            alias,
            space_id: spaceId,
            title: alias,
            description: undefined,
            warehouse_id: undefined,
            accessible: false,
            error: errorMessage(err),
          };
        }
      }),
    );
    return { spaces: entries };
  }

  async _listConversations(req: express.Request, res: express.Response) {
    const { alias } = req.params as { alias: string };
    const spaceId = this.spaces[alias];
    if (!spaceId) {
      res.status(404).json({ error: `Unknown space alias: ${alias}` });
      return;
    }
    try {
      const ws = workspaceClient();
      const pageSizeRaw = req.query.page_size;
      const pageSize =
        typeof pageSizeRaw === 'string' ? parseInt(pageSizeRaw, 10) : 50;
      const pageToken =
        typeof req.query.page_token === 'string'
          ? req.query.page_token
          : undefined;
      const response = await ws.genie.listConversations({
        space_id: spaceId,
        page_size: pageSize,
        page_token: pageToken,
      });
      res.json({
        conversations: response.conversations ?? [],
        next_page_token: response.next_page_token,
      });
    } catch (err) {
      res.status(502).json({ error: errorMessage(err) });
    }
  }

  async _attachmentQueryResult(req: express.Request, res: express.Response) {
    const { alias, conversationId, messageId, attachmentId } = req.params as {
      alias: string;
      conversationId: string;
      messageId: string;
      attachmentId: string;
    };
    const spaceId = this.spaces[alias];
    if (!spaceId) {
      res.status(404).json({ error: `Unknown space alias: ${alias}` });
      return;
    }
    try {
      const ws = workspaceClient();
      const result = await ws.genie.getMessageAttachmentQueryResult({
        space_id: spaceId,
        conversation_id: conversationId,
        message_id: messageId,
        attachment_id: attachmentId,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: errorMessage(err) });
    }
  }

  async _sendFeedback(req: express.Request, res: express.Response) {
    const { alias, conversationId, messageId } = req.params as {
      alias: string;
      conversationId: string;
      messageId: string;
    };
    const spaceId = this.spaces[alias];
    if (!spaceId) {
      res.status(404).json({ error: `Unknown space alias: ${alias}` });
      return;
    }
    const body = req.body as { rating?: unknown } | undefined;
    const rating = body?.rating;
    if (rating !== 'POSITIVE' && rating !== 'NEGATIVE' && rating !== 'NONE') {
      res
        .status(400)
        .json({ error: 'rating must be POSITIVE, NEGATIVE, or NONE' });
      return;
    }
    try {
      const ws = workspaceClient();
      await ws.genie.sendMessageFeedback({
        space_id: spaceId,
        conversation_id: conversationId,
        message_id: messageId,
        rating,
      });
      res.status(204).end();
    } catch (err) {
      res.status(502).json({ error: errorMessage(err) });
    }
  }
}

function resolveSpaces(
  configured: Record<string, string> | undefined,
): Record<string, string> {
  if (configured && Object.keys(configured).length > 0) {
    return configured;
  }
  const envMap = parseGenieSpacesEnv(process.env.GENIE_SPACES);
  if (Object.keys(envMap).length > 0) {
    return envMap;
  }
  const fallback = process.env.DATABRICKS_GENIE_SPACE_ID;
  if (fallback) {
    return { default: fallback };
  }
  return {};
}

function parseGenieSpacesEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const alias = trimmed.slice(0, eq).trim();
    const id = trimmed.slice(eq + 1).trim();
    if (alias && id) out[alias] = id;
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const genieAdvanced = toPlugin(GenieProPlugin);
