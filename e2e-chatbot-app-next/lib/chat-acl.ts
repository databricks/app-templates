import 'server-only';

import { getChatById } from '@/databricks/db/queries';
import type { Chat } from '@/databricks/db/schema';

interface ChatAccessResult {
  allowed: boolean;
  chat: Chat | null;
  reason?: 'not_found' | 'private_chat' | 'forbidden';
}

/**
 * Check if a user can access a chat based on visibility and ownership
 *
 * @param chatId - The ID of the chat to check access for
 * @param userId - The ID of the user requesting access
 * @returns ChatAccessResult indicating if access is allowed and why
 */
export async function checkChatAccess(
  chatId: string,
  userId: string,
): Promise<ChatAccessResult> {
  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return {
      allowed: false,
      chat: null,
      reason: 'not_found',
    };
  }

  // Public chats are accessible to everyone
  if (chat.visibility === 'public') {
    return {
      allowed: true,
      chat,
    };
  }

  // Private chats are only accessible to the owner
  if (chat.visibility === 'private') {
    console.log(
      `checking chat user ID vs user ID. chat user ID: ${chat.userId}, user ID: ${userId}`,
    );
    if (chat.userId !== userId) {
      return {
        allowed: false,
        chat,
        reason: 'forbidden',
      };
    }
  }

  return {
    allowed: true,
    chat,
  };
}
