'use server';

import { generateText, type UIMessage } from 'ai';
import { headers } from 'next/headers';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/databricks/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';
import { getAuthSessionFromHeaders } from '@/databricks/auth/databricks-auth';
import { ChatSDKError } from '@/lib/errors';
import { checkChatOwnership } from '@/lib/chat-acl';

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const model = await myProvider.languageModel('title-model');
  const { text: title } = await generateText({
    model,
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons. do not include other expository content ("I'll help...")`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const headersList = await headers();
  const session = await getAuthSessionFromHeaders(headersList);

  if (!session?.user) {
    throw new ChatSDKError('unauthorized:chat');
  }

  // Check ownership - throws ChatSDKError if not owner
  await checkChatOwnership(chatId, session.user.id);

  await updateChatVisiblityById({ chatId, visibility });
}
