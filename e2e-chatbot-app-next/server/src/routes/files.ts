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
 * GET /api/files/volumes/* - Proxy Unity Catalog volume files through the backend
 *
 * This endpoint proxies requests to Databricks Files API with proper authentication.
 * The frontend can request files without needing direct Databricks credentials.
 *
 * Example: GET /api/files/volumes/catalog/schema/volume/path/to/file.pdf
 * Proxies to: https://{databricks-host}/ajax-api/2.0/fs/files/Volumes/catalog/schema/volume/path/to/file.pdf
 */
filesRouter.get(
  '/volumes/{*path}',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      // Extract the full path after /volumes/
      // In Express 5 with path-to-regexp v8, {*path} captures all segments as an array
      const pathParam = req.params.path;
      const volumePath = Array.isArray(pathParam)
        ? pathParam.join('/')
        : pathParam;

      if (!volumePath) {
        return res.status(400).json({ error: 'Volume path is required' });
      }

      // Get Databricks host - prefer cached CLI host, fall back to env
      let hostUrl = getCachedCliHost();
      if (!hostUrl) {
        hostUrl = getHostUrl();
      }

      // Construct the Databricks Files API URL
      // Note: volumePath already includes "Volumes/catalog/schema/volume/filename"
      const databricksUrl = `${hostUrl}/ajax-api/2.0/fs/files/${volumePath}`;

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
        response.headers.get('content-type') || inferContentType(volumePath);

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
        const reader = response.body.getReader();

        const stream = new ReadableStream({
          async start(controller) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          },
        });

        // Convert ReadableStream to Node.js readable and pipe to response
        const nodeReadable = readableStreamToNodeReadable(stream);
        nodeReadable.pipe(res);
      } else {
        // Fallback: read entire body as buffer
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } catch (error) {
      console.error('[Files Proxy] Error:', error);

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
): NodeJS.ReadableStream {
  const reader = webStream.getReader();

  return new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        this.push(Buffer.from(value));
      }
    },
  });
}
