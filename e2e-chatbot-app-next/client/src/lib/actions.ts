import { fetchWithErrorHandlers } from './utils';
import type { VisibilityType } from '@chat-template/core';

/**
 * Update chat visibility (public/private)
 */
export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const response = await fetchWithErrorHandlers(
    `/api/chat/${chatId}/visibility`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ visibility }),
    },
  );

  return response.json();
}

/**
 * Delete messages after a certain timestamp
 */
export async function deleteTrailingMessages({
  chatId,
  messageId,
}: {
  chatId: string;
  messageId: string;
}) {
  const response = await fetchWithErrorHandlers(`/api/messages`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ chatId, messageId }),
  });

  return response.json();
}
