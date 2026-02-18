const store = new Map<string, { traceId: string | null; chatId: string }>();

export const storeMessageMeta = (
  messageId: string,
  chatId: string,
  traceId: string | null,
) => store.set(messageId, { traceId, chatId });

export const getMessageMeta = (messageId: string) =>
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
