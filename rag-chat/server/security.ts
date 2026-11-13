import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const isDevelopment = process.env.NODE_ENV === 'development';

// AppKit's server injects one inline script into index.html
// (`window.__appkit__ = JSON.parse(...)`). Its hash only changes if a new
// @databricks/appkit version changes that script.
const APPKIT_BOOTSTRAP_SCRIPT_HASH = "'sha256-yVrk4LyjmPl8qTBbtBYK/+wmplRptpNXKEcL/TXUIlM='";

// `img-src` must stay same-origin: assistant markdown can be steered by prompt
// injection in retrieved documents, and an off-site image URL would exfiltrate
// chat content the moment it renders.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' https: wss:",
  `script-src 'self' https: ${APPKIT_BOOTSTRAP_SCRIPT_HASH}`,
  "style-src 'self' https: 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' https: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
].join('; ');

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ORIGIN_FORMAT = /^https:\/\/[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$/;
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

const normalize = (origin: string) => origin.toLowerCase().replace(/\/+$/, '');

const allowedOrigins = new Set(
  [process.env.DATABRICKS_APP_URL, ...(process.env.ALLOWED_ORIGINS ?? '').split(',')]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin))
    .map(normalize)
);

// The platform always sets DATABRICKS_APP_URL, so it is only unset when running locally.
const allowLocalhost = isDevelopment || !process.env.DATABRICKS_APP_URL;

function setSecurityHeaders(res: ServerResponse) {
  // In development the Vite dev server injects inline scripts and an HMR
  // websocket, so the CSP is only sent in production.
  if (!isDevelopment) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  }
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

/**
 * A state-changing request is cross-site unless its Origin is the app's own URL
 * (DATABRICKS_APP_URL) or in ALLOWED_ORIGINS (plus http://localhost and
 * http://127.0.0.1 when running locally).
 *
 * A missing Origin is allowed (same-origin navigation or non-browser clients);
 * `Origin: null` (sandboxed iframes, data: and file: pages) is always rejected.
 */
function isCrossSiteRequest(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!STATE_CHANGING_METHODS.has(req.method ?? '') || !origin) {
    return false;
  }
  const isAllowed =
    origin !== 'null' &&
    ((ORIGIN_FORMAT.test(origin) && allowedOrigins.has(normalize(origin))) ||
      (allowLocalhost && LOCALHOST_ORIGIN.test(origin)));
  return !isAllowed;
}

/**
 * Sets security headers (CSP, clickjacking and MIME-sniffing protection) on every
 * response and rejects cross-site state-changing requests with 403.
 *
 * AppKit mounts /health and the /api/<plugin> routes before any
 * `appkit.server.extend()` middleware, so this runs in front of the HTTP server's
 * existing 'request' listener (the Express app) to cover every route.
 */
export function protectServer(server: Server) {
  const listeners = server.listeners('request') as Array<(req: IncomingMessage, res: ServerResponse) => void>;
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    setSecurityHeaders(res);
    if (isCrossSiteRequest(req)) {
      console.warn(`[CSRF] Rejected ${req.method} ${req.url?.split('?')[0]} from origin ${req.headers.origin}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    for (const listener of listeners) {
      listener.call(server, req, res);
    }
  });
}
