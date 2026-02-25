/**
 * Best-effort in-memory store for message metadata (traceId, chatId).
 *
 * In ephemeral mode (no DB), this is the sole source of message metadata.
 * In DB mode, it acts as a short-term cache to avoid extra DB lookups for
 * recently streamed messages. Data is lost on server restart in either case.
 */
const store = new Map<string, { traceId: string | null; chatId: string }>();

export const storeMessageMeta = (
  messageId: string,
  chatId: string,
  traceId: string | null,
) => store.set(messageId, { traceId, chatId });

export const getMessageMetadata = (messageId: string) =>
  store.get(messageId) ?? null;

// Assessment IDs keyed by `${messageId}:${userId}` for ephemeral-mode deduplication.
const assessmentStore = new Map<string, string>();

export const storeAssessmentId = (
  messageId: string,
  userId: string,
  assessmentId: string,
) => assessmentStore.set(`${messageId}:${userId}`, assessmentId);

export const getAssessmentId = (messageId: string, userId: string) =>
  assessmentStore.get(`${messageId}:${userId}`) ?? null;
