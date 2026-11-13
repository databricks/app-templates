import type { Request, Response, NextFunction } from "express";

// `img-src` is limited to the app's own origin so model-generated markdown in
// the chat UI can't load (and leak data to) images on arbitrary hosts. Add
// trusted image hosts here if your app needs them.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' https: wss:",
  "script-src 'self' https:",
  "style-src 'self' https: 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' https: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * Sets security headers (CSP, clickjacking and MIME-sniffing protection) on every response.
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
}
