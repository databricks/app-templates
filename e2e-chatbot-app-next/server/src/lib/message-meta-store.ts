/**
 * Best-effort in-memory store for message metadata (traceId, chatId).
 *
 * In ephemeral mode (no DB), this is the sole source of message metadata.
 * In DB mode, it acts as a short-term cache to avoid extra DB lookups for
 * recently streamed messages. Data is lost on server restart in either case.
 *
 * Both maps are size-bounded: once full, the oldest entry (by insertion order)
 * is evicted before adding a new one. This prevents unbounded memory growth in
 * long-running deployments without adding any package dependencies.
 */

// ~1 KB per entry × 10 000 entries ≈ 10 MB ceiling.
const MAX_ENTRIES = 10_000;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= MAX_ENTRIES) {
    // Map preserves insertion order; .keys().next() is the oldest entry.
    const oldest = map.keys().next().value as K;
    map.delete(oldest);
  }
  map.set(key, value);
}

const store = new Map<string, { traceId: string | null; chatId: string }>();

export const storeMessageMeta = (
  messageId: string,
  chatId: string,
  traceId: string | null,
) => setBounded(store, messageId, { traceId, chatId });

export const getMessageMetadata = (messageId: string) =>
  store.get(messageId) ?? null;

// Assessment IDs keyed by `${messageId}:${userId}` for ephemeral-mode deduplication.
const assessmentStore = new Map<string, string>();

export const storeAssessmentId = (
  messageId: string,
  userId: string,
  assessmentId: string,
) => setBounded(assessmentStore, `${messageId}:${userId}`, assessmentId);

export const getAssessmentId = (messageId: string, userId: string) =>
  assessmentStore.get(`${messageId}:${userId}`) ?? null;
