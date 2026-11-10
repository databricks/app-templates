import type { Request, Response } from 'express';

// Databricks Apps injects `x-forwarded-email` at the gateway and strips any
// client-supplied value. Treat that header as the authoritative user identity
// when running on the platform.
//
// We use `DATABRICKS_CLIENT_ID` as the "deployed on Databricks Apps" signal:
// it's the auto-injected service-principal credential, present only in the
// runtime — local `.env` (scaffolded by `databricks apps init`) pre-sets
// things like `DATABRICKS_APP_NAME` but never `DATABRICKS_CLIENT_ID`.

export function authenticateUser(req: Request, res: Response): string | null {
  const email = req.header('x-forwarded-email');
  if (email) return email;
  if (process.env.DATABRICKS_CLIENT_ID) {
    res.status(401).json({
      error: 'Missing x-forwarded-email. Databricks Apps should inject this header at the gateway.',
    });
    return null;
  }
  return 'local-dev-user';
}
