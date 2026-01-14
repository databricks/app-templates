import { apiUrl, fetchWithErrorHandlers } from './utils';
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
    apiUrl(`/api/chat/${chatId}/visibility`),
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
  messageId,
}: {
  messageId: string;
}) {
  const response = await fetchWithErrorHandlers(
    apiUrl(`/api/messages/${messageId}/trailing`),
    {
      method: 'DELETE',
      credentials: 'include',
    },
  );

  if (response.status === 204) {
    return null;
  }

  return response.json();
}
