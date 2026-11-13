import type { Request, Response, NextFunction } from 'express';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ORIGIN_FORMAT = /^https:\/\/[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$/;
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

const normalize = (origin: string) => origin.toLowerCase().replace(/\/+$/, '');

/**
 * Parses a comma-separated origin list (e.g. ALLOWED_ORIGINS). Entries are
 * trimmed, lower-cased and stripped of trailing slashes; only https origins
 * are kept.
 */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => normalize(origin.trim()))
    .filter((origin) => ORIGIN_FORMAT.test(origin));
}

/**
 * Whether a request's Origin header is a valid https origin in `allowedOrigins`
 * (as returned by `parseOrigins`), compared case-insensitively.
 */
export function matchesOrigin(origin: string, allowedOrigins: Set<string>) {
  return ORIGIN_FORMAT.test(origin) && allowedOrigins.has(normalize(origin));
}

/**
 * Rejects cross-site state-changing requests by validating the Origin header
 * against the app's own URL (DATABRICKS_APP_URL) and ALLOWED_ORIGINS.
 *
 * A missing Origin is allowed (same-origin navigation or non-browser clients);
 * `Origin: null` (sandboxed iframes, data: and file: pages) is always rejected.
 * Localhost origins are also allowed in development or when DATABRICKS_APP_URL
 * is unset (local runs).
 */
export function createCsrfMiddleware({
  isDevelopment,
}: { isDevelopment: boolean }) {
  const appUrl = process.env.DATABRICKS_APP_URL;
  const allowedOrigins = new Set([
    ...parseOrigins(appUrl),
    ...parseOrigins(process.env.ALLOWED_ORIGINS),
  ]);
  const allowLocalhost = isDevelopment || !appUrl;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return next();
    }

    const origin = req.headers.origin;
    if (!origin) {
      return next();
    }

    const isAllowed =
      origin !== 'null' &&
      (matchesOrigin(origin, allowedOrigins) ||
        (allowLocalhost && LOCALHOST_ORIGIN.test(origin)));

    if (!isAllowed) {
      console.warn(
        `[CSRF] Rejected ${req.method} ${req.path} from origin ${origin}`,
      );
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}
