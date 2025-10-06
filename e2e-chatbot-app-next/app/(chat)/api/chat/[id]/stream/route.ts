import { streamCache } from '@/lib/stream-cache';
import { UI_MESSAGE_STREAM_HEADERS } from 'ai';
import { getAuthSession } from '@/databricks/auth/databricks-auth';
import { checkChatAccess } from '@/lib/chat-acl';

/**
 * GET /api/chat/[id]/stream
 *
 * Resume an active stream for a chat. This endpoint is called by the client's
 * `resume` option in useChat when reconnecting after a timeout or page reload.
 *
 * Returns:
 * - 204 No Content: If no active stream exists for this chat
 * - 200 with stream: If an active stream is found, returns all cached chunks
 * - 404 Not Found: If chat doesn't exist
 * - 403 Forbidden: If user doesn't have access to the chat
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chatId } = await params;
  const cursor = _request.headers.get('X-Resume-Stream-Cursor');

  console.log(`[Stream Resume] Cursor: ${cursor}`);

  console.log(`[Stream Resume] GET request for chat ${chatId}`);

  // Check if there's an active stream for this chat first
  const streamId = streamCache.getActiveStreamId(chatId);

  if (!streamId) {
    console.log(`[Stream Resume] No active stream for chat ${chatId}`);
    return new Response(null, { status: 204 });
  }

  // Verify user has access to the chat (if it exists in the database)
  const session = await getAuthSession(_request);

  if (!session?.user) {
    console.log(`[Stream Resume] No authenticated user`);
    return new Response('Unauthorized', { status: 401 });
  }

  const { allowed, reason } = await checkChatAccess(chatId, session.user.id);

  // If chat doesn't exist in DB, it's a temporary chat from the homepage - allow it
  if (reason === 'not_found') {
    console.log(
      `[Stream Resume] Resuming stream for temporary chat ${chatId} (not yet in DB)`,
    );
  } else if (!allowed) {
    console.log(
      `[Stream Resume] User ${session.user.id} does not have access to chat ${chatId} (reason: ${reason})`,
    );
    return new Response('Forbidden', { status: 403 });
  }

  // Get all cached chunks for this stream
  const stream = streamCache.getStream(streamId, {
    cursor: cursor ? Number.parseInt(cursor) : undefined,
  });

  if (!stream) {
    console.log(`[Stream Resume] No stream found for ${streamId}`);
    return new Response(null, { status: 204 });
  }

  console.log(`[Stream Resume] Resuming stream ${streamId}`);

  return new Response(stream, {
    status: 200,
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
}
