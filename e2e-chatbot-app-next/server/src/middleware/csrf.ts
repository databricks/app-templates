import type { Request, Response, NextFunction } from 'express';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ORIGIN_FORMAT = /^https:\/\/[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$/;
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

const normalize = (origin: string) => origin.toLowerCase().replace(/\/+$/, '');

/**
 * Rejects cross-site state-changing requests by validating the Origin header
 * against the app's own URL (DATABRICKS_APP_URL) and ALLOWED_ORIGINS.
 *
 * A missing Origin is allowed (same-origin navigation or non-browser clients);
 * `Origin: null` (sandboxed iframes, data: and file: pages) is always rejected.
 */
export function createCsrfMiddleware({
  isDevelopment,
}: { isDevelopment: boolean }) {
  const allowedOrigins = new Set(
    [
      process.env.DATABRICKS_APP_URL,
      ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
    ]
      .map((origin) => origin?.trim())
      .filter((origin): origin is string => Boolean(origin))
      .map(normalize),
  );

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
      ((ORIGIN_FORMAT.test(origin) && allowedOrigins.has(normalize(origin))) ||
        (isDevelopment && LOCALHOST_ORIGIN.test(origin)));

    if (!isAllowed) {
      console.warn(
        `[CSRF] Rejected ${req.method} ${req.path} from origin ${origin}`,
      );
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}
