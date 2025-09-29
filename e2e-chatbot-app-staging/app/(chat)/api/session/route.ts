import {
  getAuthSession,
  type ClientSession,
} from '@/databricks/auth/databricks-auth';

export async function GET(request: Request) {
  const session = await getAuthSession(request);

  if (!session?.user) {
    return Response.json({ user: null } as ClientSession, { status: 200 });
  }

  // Return minimal user data for client
  const clientSession: ClientSession = {
    user: {
      email: session.user.email,
      name: session.user.name,
      preferredUsername: session.user.preferredUsername,
    },
  };

  return Response.json(clientSession, { status: 200 });
}
