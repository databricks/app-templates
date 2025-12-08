import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { Readable } from 'node:stream';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { getDatabricksToken, getCachedCliHost } from '@chat-template/auth';
import { getHostUrl } from '@chat-template/utils';

export const filesRouter: RouterType = Router();

// Apply auth middleware to all file routes
filesRouter.use(authMiddleware);

/**
 * POST /api/files/databricks-file - Proxy Databricks files through the backend
 *
 * This endpoint proxies requests to Databricks Files API with proper authentication.
 * The frontend can request files without needing direct Databricks credentials.
 *
 * Request body: { "path": "/Volumes/catalog/schema/volume/path/to/file.pdf" }
 * Proxies to: https://{databricks-host}/api/2.0/fs/files/Volumes/catalog/schema/volume/path/to/file.pdf
 *
 * @see https://docs.databricks.com/api/workspace/files/download
 */
filesRouter.post(
  '/databricks-file',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.body as { path?: string };

      if (!filePath || typeof filePath !== 'string') {
        return res
          .status(400)
          .json({ error: 'File path is required in request body' });
      }

      // Get Databricks host - prefer cached CLI host, fall back to env
      let hostUrl = getCachedCliHost();
      if (!hostUrl) {
        hostUrl = getHostUrl();
      }

      // Construct the Databricks Files API URL
      // Path should start with /Volumes/ for Unity Catalog volumes
      // See: https://docs.databricks.com/api/workspace/files/download
      const normalizedPath = filePath.startsWith('/')
        ? filePath
        : `/${filePath}`;
      const databricksUrl = `${hostUrl}/api/2.0/fs/files${normalizedPath}`;

      console.log(`[Files Proxy] Fetching: ${databricksUrl}`);

      // Get authentication token
      const token = await getDatabricksToken();

      // Fetch the file from Databricks
      const response = await fetch(databricksUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        console.error(
          `[Files Proxy] Databricks API error: ${response.status} ${response.statusText}`,
        );

        // Map Databricks errors to appropriate HTTP responses
        if (response.status === 404) {
          return res.status(404).json({ error: 'File not found' });
        }
        if (response.status === 403) {
          return res.status(403).json({ error: 'Permission denied' });
        }

        return res.status(response.status).json({
          error: `Failed to fetch file: ${response.statusText}`,
        });
      }

      // Get content type from response or infer from file extension
      const contentType =
        response.headers.get('content-type') || inferContentType(filePath);

      // Set response headers
      res.setHeader('Content-Type', contentType);

      // Forward content-length if available
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // Forward content-disposition if available (for downloads)
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      }

      // Stream the response body to the client
      if (response.body) {
        const nodeReadable = readableStreamToNodeReadable(response.body);

        // Handle stream errors to prevent server crash
        nodeReadable.on('error', (err) => {
          console.error('[Files Proxy] Stream read error:', err);
          // Only try to send error if response hasn't started
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error while fetching file' });
          } else {
            // Response already started, just end it
            res.end();
          }
        });

        // Handle response errors
        res.on('error', (err) => {
          console.error('[Files Proxy] Response write error:', err);
          nodeReadable.destroy();
        });

        // Handle client disconnect
        res.on('close', () => {
          nodeReadable.destroy();
        });

        nodeReadable.pipe(res);
      } else {
        // Fallback: read entire body as buffer
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } catch (error) {
      console.error('[Files Proxy] Error:', error);

      // Don't try to send response if headers already sent
      if (res.headersSent) {
        return res.end();
      }

      if (error instanceof Error) {
        return res.status(500).json({
          error: 'Failed to fetch file',
          message: error.message,
        });
      }

      return res.status(500).json({ error: 'Failed to fetch file' });
    }
  },
);

/**
 * Infer content type from file extension
 */
function inferContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    xml: 'application/xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Convert a Web ReadableStream to a Node.js Readable stream
 */
function readableStreamToNodeReadable(
  webStream: ReadableStream<Uint8Array>,
): Readable {
  const reader = webStream.getReader();

  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    },
    destroy(err, callback) {
      reader.cancel(err?.message).finally(() => callback(err));
    },
  });
}
