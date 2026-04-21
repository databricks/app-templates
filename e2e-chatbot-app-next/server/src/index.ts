// Load environment variables FIRST before any other imports
import './env';

import express, {
  type Request,
  type Response,
  type NextFunction,
  type Express,
} from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chatRouter } from './routes/chat';
import { storeMessageMeta } from './lib/message-meta-store';
import { historyRouter } from './routes/history';
import { sessionRouter } from './routes/session';
import { messagesRouter } from './routes/messages';
import { configRouter } from './routes/config';
import { feedbackRouter } from './routes/feedback';
import { ChatSDKError } from '@chat-template/core/errors';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app: Express = express();
const isDevelopment = process.env.NODE_ENV !== 'production';
// Either let PORT be set by env or use 3001 for development and 3000 for production
// The CHAT_APP_PORT can be used to override the port for the chat app.
const PORT =
  process.env.CHAT_APP_PORT ||
  process.env.PORT ||
  (isDevelopment ? 3001 : 3000);

// CORS configuration
app.use(
  cors({
    origin: isDevelopment ? 'http://localhost:3000' : true,
    credentials: true,
  }),
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (for Playwright tests)
app.get('/ping', (_req, res) => {
  res.status(200).send('pong');
});

// API routes
app.use('/api/chat', chatRouter);
app.use('/api/history', historyRouter);
app.use('/api/session', sessionRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/config', configRouter);
app.use('/api/feedback', feedbackRouter);

// Agent backend proxy (optional)
// If AGENT_BACKEND_URL (or legacy API_PROXY) is set, proxy /invocations
// requests to the agent backend. For streaming POSTs we rewrite into
// LongRunningAgentServer's "background" contract: the backend persists every
// event to Lakebase, the proxy auto-resumes via
//   GET /responses/{id}?stream=true&starting_after=N
// if the upstream connection dies before the [DONE] sentinel. This is what
// makes the UI survive mid-response pod crashes — zero client-side changes.
//
// IMPORTANT: when running with the Python FastAPI backend, point
// AGENT_BACKEND_URL at FastAPI (e.g. http://localhost:8000/invocations) and
// set API_PROXY at THIS Express server (e.g. http://localhost:3000/invocations)
// so the AI SDK provider in providers-server.ts routes through this handler
// instead of going direct to FastAPI.
const agentBackendUrl = process.env.AGENT_BACKEND_URL || process.env.API_PROXY;
if (agentBackendUrl) {
  console.log(
    `✅ Proxying /invocations to ${agentBackendUrl} (durable-resume enabled)`,
  );

  // Derive the retrieve endpoint (strip trailing /invocations or /responses)
  const backendRoot = agentBackendUrl.replace(/\/(invocations|responses)\/?$/, '');
  const retrieveUrl = (rid: string, startingAfter: number) =>
    `${backendRoot}/responses/${rid}?stream=true&starting_after=${startingAfter}`;

  app.all('/invocations', async (req: Request, res: Response) => {
    try {
      const forwardHeaders = { ...req.headers } as Record<string, string>;
      // biome-ignore lint/performance/noDelete: fetch rejects empty content-length
      delete forwardHeaders['content-length'];

      const isStreamingPost =
        req.method === 'POST' &&
        req.body &&
        typeof req.body === 'object' &&
        (req.body.stream === true || req.body.stream === 'true');

      // Non-streaming or non-POST: original passthrough behavior.
      if (!isStreamingPost) {
        const response = await fetch(agentBackendUrl, {
          method: req.method,
          headers: forwardHeaders,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? JSON.stringify(req.body)
              : undefined,
        });
        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
        return;
      }

      // Streaming POST → background mode with auto-resume.
      const durableBody = {
        ...req.body,
        background: true,
        stream: true,
      };

      // Prime SSE headers immediately so the client starts reading even if the
      // first upstream chunk takes a moment.
      res.status(200);
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.flushHeaders?.();

      let responseId: string | null = null;
      let lastSeq = 0;
      let sawDone = false;
      // Terminal-error flag: task_failed / task_timeout from upstream.
      let sawTerminalError = false;
      // Safety cap so a permanently-broken backend can't loop forever.
      const MAX_RESUME_ATTEMPTS = 10;
      let resumeAttempt = 0;

      // Tracks the in-progress assistant message item so we can emit
      // synthetic closure events on resume. Without this, attempt 2's
      // deltas append to attempt 1's text part in the AI SDK's state.
      type ActiveMessage = {
        itemId: string;
        outputIndex: number;
        contentIndex: number;
        text: string;
      };
      let activeMessage: ActiveMessage | null = null;

      const writeEvent = (type: string, payload: Record<string, unknown>) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
      };

      // Emit content_part.done + output_item.done for the active message so
      // the Vercel AI SDK finalizes its text part and starts a fresh one on
      // attempt 2's next output_item.added.
      const sealActiveMessage = () => {
        if (!activeMessage) return;
        const { itemId, outputIndex, contentIndex, text } = activeMessage;
        writeEvent('response.content_part.done', {
          item_id: itemId,
          output_index: outputIndex,
          content_index: contentIndex,
          part: { type: 'output_text', text, annotations: [] },
        });
        writeEvent('response.output_item.done', {
          output_index: outputIndex,
          item: {
            id: itemId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        });
        activeMessage = null;
      };

      // Read one SSE stream, track metadata + in-progress items, optionally
      // emit synthetic closure events, then forward each frame to the client.
      // Returns whether we saw the [DONE] sentinel.
      const pumpStream = async (upstream: globalThis.Response) => {
        if (!upstream.body) return false;
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split(/\n\n/);
          buf = frames.pop() || '';
          for (const frame of frames) {
            const frameBytes = `${frame}\n\n`;
            if (frame.includes('data: [DONE]')) {
              res.write(frameBytes);
              return true;
            }
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) {
              res.write(frameBytes);
              continue;
            }
            let parsed: Record<string, unknown> | undefined;
            try {
              parsed = JSON.parse(dataLine.slice(5).trim());
            } catch {
              // Non-JSON SSE frame (e.g. heartbeats) — forward as-is.
              res.write(frameBytes);
              continue;
            }
            if (!parsed) {
              res.write(frameBytes);
              continue;
            }
            // Track response_id (several possible locations).
            const nested = parsed.response as
              | { id?: unknown }
              | undefined;
            const rid =
              (typeof parsed.response_id === 'string'
                ? (parsed.response_id as string)
                : undefined) ??
              (typeof nested?.id === 'string' ? nested.id : undefined) ??
              (typeof parsed.id === 'string' &&
              (parsed.id as string).startsWith('resp_')
                ? (parsed.id as string)
                : undefined);
            if (!responseId && typeof rid === 'string') {
              responseId = rid;
              console.log(`[/invocations] background started response_id=${responseId}`);
            }
            if (
              typeof parsed.sequence_number === 'number' &&
              (parsed.sequence_number as number) > lastSeq
            ) {
              lastSeq = parsed.sequence_number as number;
            }
            const eventType = parsed.type as string | undefined;
            const item = (parsed.item as Record<string, unknown> | undefined) ?? undefined;
            // Update activeMessage state (pre-forward).
            if (
              eventType === 'response.output_item.added' &&
              item?.type === 'message'
            ) {
              activeMessage = {
                itemId: (item.id as string) || '',
                outputIndex: (parsed.output_index as number) ?? 0,
                contentIndex: 0,
                text: '',
              };
            } else if (
              eventType === 'response.output_text.delta' &&
              activeMessage &&
              (parsed.item_id as string) === activeMessage.itemId
            ) {
              activeMessage.text += (parsed.delta as string) ?? '';
            } else if (
              eventType === 'response.output_item.done' &&
              item?.type === 'message' &&
              activeMessage?.itemId === (item.id as string)
            ) {
              // Backend closed the message itself; we don't need our synthetic
              // closure.
              activeMessage = null;
            }
            // On the resume sentinel, seal the active message before
            // forwarding the sentinel. Attempt 2 emits a fresh output_item.added
            // with a new id, so the AI SDK starts a clean text part for it.
            if (eventType === 'response.resumed' && activeMessage) {
              sealActiveMessage();
            }
            // Detect terminal errors (task_failed, task_timeout, etc.) so we
            // don't burn MAX_RESUME_ATTEMPTS fetching a response that will
            // never succeed. Upstream LLM 502s and permanent run failures
            // both surface here.
            if (eventType === 'error') {
              const errObj = (parsed.error as Record<string, unknown>) || {};
              const code = errObj.code as string | undefined;
              if (code === 'task_failed' || code === 'task_timeout') {
                console.log(
                  `[/invocations] terminal error code=${code} response_id=${responseId}; not retrying`,
                );
                sawTerminalError = true;
              }
            }
            res.write(frameBytes);
          }
        }
        return false;
      };

      // Kickoff: POST background request.
      const initial = await fetch(agentBackendUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(durableBody),
      });
      if (!initial.ok) {
        const text = await initial.text();
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: { message: text, status: initial.status } })}\n\n`,
        );
        res.end();
        return;
      }
      sawDone = await pumpStream(initial);

      // Auto-resume loop: if upstream closed early and we have a response_id,
      // reconnect via the retrieve endpoint using our cursor.
      if (!sawDone && responseId) {
        console.log(
          `[/invocations] upstream closed without [DONE] response_id=${responseId} last_seq=${lastSeq}; entering auto-resume`,
        );
      }
      while (!sawDone && !sawTerminalError && responseId && resumeAttempt < MAX_RESUME_ATTEMPTS) {
        resumeAttempt += 1;
        console.log(
          `[/invocations] resume fetch response_id=${responseId} starting_after=${lastSeq} attempt=${resumeAttempt}`,
        );
        const resumed = await fetch(retrieveUrl(responseId, lastSeq), {
          method: 'GET',
          headers: forwardHeaders,
        });
        if (!resumed.ok) {
          console.log(
            `[/invocations] resume failed response_id=${responseId} status=${resumed.status}`,
          );
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: { message: 'Resume fetch failed', status: resumed.status } })}\n\n`,
          );
          break;
        }
        sawDone = await pumpStream(resumed);
        if (sawDone) {
          console.log(
            `[/invocations] resume succeeded response_id=${responseId} after ${resumeAttempt} attempts`,
          );
        }
      }

      if (responseId) {
        console.log(
          `[/invocations] stream done response_id=${responseId} saw_done=${sawDone} last_seq=${lastSeq} resumes=${resumeAttempt}`,
        );
      }
      res.end();
    } catch (error) {
      console.error('[/invocations proxy] Error:', error);
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Proxy error',
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        try {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } })}\n\n`,
          );
          res.end();
        } catch {}
      }
    }
  });
}

// Serve static files in production
if (!isDevelopment) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);

  if (err instanceof ChatSDKError) {
    const response = err.toResponse();
    return res.status(response.status).json(response.json);
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
  });
});

// Start MSW mock server in test mode
async function startServer() {
  if (process.env.PLAYWRIGHT === 'True') {
    console.log('[Test Mode] Starting MSW mock server for API mocking...');
    try {
      // Dynamically import MSW setup from tests directory (using relative path from server root)
      const modulePath = path.join(
        dirname(dirname(__dirname)),
        'tests',
        'api-mocking',
        'api-mock-server.ts',
      );
      console.log('[Test Mode] Attempting to load MSW from:', modulePath);

      const { mockServer } = await import(modulePath);

      mockServer.listen({
        onUnhandledRequest: (request: Request) => {
          console.warn(
            `[MSW] Unhandled ${request.method} request to ${request.url}`,
          );
        },
      });

      console.log('[Test Mode] MSW mock server started successfully');
      console.log(
        '[Test Mode] Registered handlers:',
        mockServer.listHandlers().length,
      );

      // Import captured request utilities for testing context injection
      const handlersPath = path.join(
        dirname(dirname(__dirname)),
        'tests',
        'api-mocking',
        'api-mock-handlers.ts',
      );
      const {
        getCapturedRequests,
        resetCapturedRequests,
        getLastCapturedRequest,
        resetMlflowAssessmentStore,
        getLastServingRequestHeaders,
      } = await import(handlersPath);

      // Test-only endpoint to get captured requests (for context injection testing)
      app.get('/api/test/captured-requests', (_req, res) => {
        res.json(getCapturedRequests());
      });

      // Test-only endpoint to get the last captured request
      app.get('/api/test/last-captured-request', (_req, res) => {
        const lastRequest = getLastCapturedRequest();
        if (lastRequest) {
          res.json(lastRequest);
        } else {
          res.status(404).json({ error: 'No captured requests' });
        }
      });

      // Test-only endpoint to reset captured requests
      app.post('/api/test/reset-captured-requests', (_req, res) => {
        resetCapturedRequests();
        res.json({ success: true });
      });

      // Test-only endpoint to reset MLflow assessment store
      app.post('/api/test/reset-mlflow-store', (_req, res) => {
        resetMlflowAssessmentStore();
        res.json({ success: true });
      });

      // Test-only endpoint to read headers from the last serving endpoint request
      app.get('/api/test/serving-request-headers', (_req, res) => {
        res.json(getLastServingRequestHeaders());
      });

      console.log(
        '[Test Mode] Test endpoints for context injection registered',
      );
    } catch (error) {
      console.error('[Test Mode] Failed to start MSW:', error);
      console.error(
        '[Test Mode] Error details:',
        error instanceof Error ? error.stack : error,
      );
    }

    // Registered outside the MSW try/catch so it's available even if MSW setup fails.
    // Lets tests simulate a message from an endpoint that doesn't return traces.
    app.post('/api/test/store-message-meta', (req, res) => {
      const { messageId, chatId, traceId } = req.body as {
        messageId: string;
        chatId: string;
        traceId: string | null;
      };
      storeMessageMeta(messageId, chatId, traceId ?? null);
      res.json({ success: true });
    });
  }

  app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${isDevelopment ? 'development' : 'production'}`);
  });
}

startServer();

export default app;
