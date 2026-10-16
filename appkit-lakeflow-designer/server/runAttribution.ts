import { randomUUID } from 'node:crypto';

export const APP_PARAMETERS_PARAM = '_lb_app_parameters';

interface ForwardedHeaders {
  get(name: string): string | undefined;
}

// Apps ingress supplies these headers. Body parameters never establish the submitting user.
export async function runAttribution(
  headers: ForwardedHeaders,
  appId: string,
  readUserProfile?: (token: string) => Promise<{ id?: string; displayName?: string }>,
): Promise<Record<string, string> | undefined> {
  const subject = headers.get('x-forwarded-user')?.trim();
  if (!subject) return undefined;
  const userId = /^(\d+)@\d+$/.exec(subject)?.[1] ?? subject;
  const email = headers.get('x-forwarded-email')?.trim() ?? '';
  let name = headers.get('x-forwarded-preferred-username')?.trim();
  const token = headers.get('x-forwarded-access-token')?.trim();
  if ((!name || name === email) && token && readUserProfile) {
    try {
      const profile = await readUserProfile(token);
      if (profile.id === userId) name = profile.displayName?.trim() || name;
    } catch {
      // Profile availability must not block a run whose ingress identity is already verified.
    }
  }
  return {
    _lb_app_id: appId,
    _lb_app_user_id: userId,
    _lb_app_user_name: name || email || userId,
    _lb_app_user_email: email,
    _lb_app_submission_id: randomUUID(),
  };
}
