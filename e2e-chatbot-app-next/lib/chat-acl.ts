import 'server-only';

import { getChatById } from '@/databricks/db/queries';
import type { Chat } from '@/databricks/db/schema';
import { ChatSDKError } from '@/lib/errors';

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

/**
 * Check if a user owns a chat and throw standardized errors if not
 *
 * @param chatId - The ID of the chat to check ownership for
 * @param userId - The ID of the user to verify as owner
 * @returns The chat if the user is the owner
 * @throws ChatSDKError if chat not found or user is not the owner
 */
export async function checkChatOwnership(
  chatId: string,
  userId: string,
): Promise<Chat> {
  const chat = await getChatById({ id: chatId });

  if (!chat) {
    throw new ChatSDKError('not_found:chat');
  }

  if (chat.userId !== userId) {
    throw new ChatSDKError('forbidden:chat');
  }

  return chat;
}
