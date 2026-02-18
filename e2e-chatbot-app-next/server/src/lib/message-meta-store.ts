const store = new Map<string, { traceId: string | null; chatId: string }>();

export const storeMessageMeta = (
  messageId: string,
  chatId: string,
  traceId: string | null,
) => store.set(messageId, { traceId, chatId });

export const getMessageMeta = (messageId: string) =>
  store.get(messageId) ?? null;
