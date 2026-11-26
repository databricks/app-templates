import { convertToModelMessages } from 'ai';

/**
 * Converts the chat's UI messages into the model messages sent to the provider.
 *
 * Tool calls that never got a result are dropped (`ignoreIncompleteToolCalls`).
 * Providers reject a tool call with no matching result, and the history can
 * carry one when a stream was interrupted mid-tool-call, or when a client
 * resends a stale copy of a call that has since completed.
 */
export function toModelMessages(
  uiMessages: Parameters<typeof convertToModelMessages>[0],
) {
  return convertToModelMessages(uiMessages, {
    ignoreIncompleteToolCalls: true,
  });
}
