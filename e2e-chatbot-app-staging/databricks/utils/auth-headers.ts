import 'server-only';

import { getUserFromHeaders, type User } from '@/databricks/db/queries';

export type UserType = 'guest' | 'regular';

export interface AuthUser {
  id: string;
  email: string;
  type: UserType;
}

export interface AuthSession {
  user: AuthUser;
}

/**
 * Get user from Databricks Apps headers or local development environment
 * This replaces NextAuth for environments where we get user info from HTTP headers
 */
export async function authFromHeaders(
  request: Request,
): Promise<AuthSession | null> {
  try {
    const user: User = await getUserFromHeaders(request);

    return {
      user: {
        id: user.id,
        email: user.email || '',
        type: 'regular' as UserType,
      },
    };
  } catch (error) {
    console.error('[authFromHeaders] Failed to get user from headers:', error);
    return null;
  }
}

/**
 * Check if we should use header-based auth (Databricks Apps) or fall back to NextAuth
 */
export function shouldUseHeaderAuth(request: Request): boolean {
  // Use header auth if X-Forwarded-User is present (Databricks Apps)
  // or if we're in local development without NextAuth session
  return (
    request.headers.has('X-Forwarded-User') ||
    process.env.NODE_ENV === 'development'
  );
}

/**
 * Check if we should use header-based auth with Next.js headers object
 */
export function shouldUseHeaderAuthFromHeaders(headersList: Headers): boolean {
  return (
    headersList.has('X-Forwarded-User') ||
    process.env.NODE_ENV === 'development'
  );
}

/**
 * Get user from headers for Next.js page components (using headers() from 'next/headers')
 */
export async function authFromNextHeaders(
  headersList: Headers,
): Promise<AuthSession | null> {
  try {
    // Create a mock request object for the existing function
    const mockRequest = {
      headers: {
        get: (name: string) => headersList.get(name),
        has: (name: string) => headersList.has(name),
      },
    } as Request;

    const user = await getUserFromHeaders(mockRequest);

    return {
      user: {
        id: user.id,
        email: user.email || '',
        type: 'regular' as UserType,
      },
    };
  } catch (error) {
    console.error(
      '[authFromNextHeaders] Failed to get user from headers:',
      error,
    );
    return null;
  }
}
