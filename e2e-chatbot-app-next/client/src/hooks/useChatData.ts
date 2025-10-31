import useSWR from 'swr';
import type { Chat } from '@chat-template/db';
import type { ChatMessage } from '@chat-template/core';
import { convertToUIMessages } from '@/lib/utils';

interface ChatData {
  chat: Chat;
  messages: ChatMessage[];
}

/**
 * Fetcher function that loads both chat metadata and messages
 * Returns null if chat is not found or user doesn't have access
 */
async function fetchChatData(url: string): Promise<ChatData | null> {
  const chatId = url.split('/').pop();

  // Fetch chat details
  const chatResponse = await fetch(`/api/chat/${chatId}`, {
    credentials: 'include',
  });

  if (!chatResponse.ok) {
    if (chatResponse.status === 404 || chatResponse.status === 403) {
      return null;
    }
    throw new Error('Failed to load chat');
  }

  const chat = await chatResponse.json();

  // Fetch messages
  const messagesResponse = await fetch(`/api/messages/${chatId}`, {
    credentials: 'include',
  });

  if (!messagesResponse.ok) {
    // If messages endpoint returns 404 (e.g., database disabled), return empty messages
    if (messagesResponse.status === 404) {
      return {
        chat,
        messages: [],
      };
    }
    throw new Error('Failed to load messages');
  }

  const messagesFromDb = await messagesResponse.json();
  const messages = convertToUIMessages(messagesFromDb);

  return {
    chat,
    messages,
  };
}

/**
 * Custom hook to fetch chat data using SWR
 * Provides automatic caching, deduplication, and race condition prevention
 *
 * @param chatId - The ID of the chat to load
 * @param enabled - Whether to fetch data (defaults to true when chatId is provided)
 * @returns Chat data, loading state, and error state
 */
export function useChatData(chatId: string | undefined, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<ChatData | null>(
    // Only fetch if chatId exists and enabled is true
    chatId && enabled ? `/chat/${chatId}` : null,
    fetchChatData,
    {
      // Revalidate when window regains focus
      revalidateOnFocus: false,
      // Don't revalidate on reconnect (messages are loaded via stream anyway)
      revalidateOnReconnect: false,
      // Keep previous data while loading new data to prevent flashing
      keepPreviousData: true,
      // Dedupe requests within 2 seconds
      dedupingInterval: 2000,
    }
  );

  return {
    chatData: data,
    isLoading,
    error: error ? 'Failed to load chat' : data === null && !isLoading ? 'Chat not found or you do not have access' : null,
    mutate, // Expose mutate for manual cache updates if needed
  };
}
