import type { NextFunction, Request, Response } from 'express';

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

/**
 * Sets security headers (CSP, clickjacking and MIME-sniffing protection) on every response.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  // In development the Vite dev server injects inline scripts and an HMR
  // websocket, so the CSP is only sent in production.
  if (!isDevelopment) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  }
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/**
 * Rejects cross-site state-changing requests by validating the Origin header
 * against the app's own URL (DATABRICKS_APP_URL) and ALLOWED_ORIGINS
 * (plus http://localhost and http://127.0.0.1 when running locally).
 *
 * A missing Origin is allowed (same-origin navigation or non-browser clients);
 * `Origin: null` (sandboxed iframes, data: and file: pages) is always rejected.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  const isAllowed =
    origin !== 'null' &&
    ((ORIGIN_FORMAT.test(origin) && allowedOrigins.has(normalize(origin))) ||
      (allowLocalhost && LOCALHOST_ORIGIN.test(origin)));

  if (!isAllowed) {
    console.warn(`[CSRF] Rejected ${req.method} ${req.path} from origin ${origin}`);
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}
