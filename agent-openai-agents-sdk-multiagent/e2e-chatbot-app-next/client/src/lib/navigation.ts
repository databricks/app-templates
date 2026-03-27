import { matchPath } from 'react-router-dom';

/**
 * Soft navigation to a chat ID - updates the browser URL without triggering React Router navigation.
 *
 * This function uses window.history.replaceState to update the URL to /chat/:id
 * without causing React Router to remount components. It's called "soft" navigation
 * because it only updates the URL bar, not the application state.
 *
 * When chat history is disabled (ephemeral mode), this function does nothing,
 * keeping the user on the homepage (/) to prevent creating URLs to chats
 * that won't be persisted.
 *
 * @param chatId - The chat ID to navigate to
 * @param chatHistoryEnabled - Whether chat history persistence is enabled
 *
 * @example
 * // With chat history enabled - URL changes to /chat/abc-123
 * softNavigateToChatId('abc-123', true);
 *
 * @example
 * // With chat history disabled - URL stays at /
 * softNavigateToChatId('abc-123', false);
 */
export function softNavigateToChatId(
  chatId: string,
  chatHistoryEnabled: boolean,
): void {
  if (!chatHistoryEnabled) {
    // In ephemeral mode, don't change the URL - keep user on homepage
    return;
  }

  // Update URL to /chat/:id without triggering navigation
  window.history.replaceState({}, '', `/chat/${chatId}`);
}

/**
 * Extract the chat ID from the current browser pathname.
 * Useful after a soft navigation where React Router's useParams()
 * doesn't reflect the replaceState change.
 */
export function getChatIdFromPathname(): string | undefined {
  return matchPath('/chat/:id', window.location.pathname)?.params.id;
}
