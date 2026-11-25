// Review Queue client for your UI. Template-owned: import it, do not edit it.
//
//   import { review } from '/_review/review.js';
//
// Every call runs as the signed-in reviewer: the server only returns queues they are a member of,
// and only that queue's items. Trace data and answers are untrusted text: never put them in innerHTML.

export class ReviewError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // 404: not found or not a member. 502: MLflow refused the app (see /setup).
  }
}

async function call(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ReviewError(data.error || data.detail || `Request failed (${res.status})`, res.status);
  return data;
}

const q = encodeURIComponent;

export const review = {
  /** The signed-in reviewer's email. */
  me: async () => (await call('/api/review-queue/me')).email,

  /** Queues the reviewer is a member of: [{ id, display_name, queue_type, pending_item_count, total_item_count }]. */
  listQueues: async () => (await call('/api/review-queue/queues')).queues,

  /** A queue's items: [{ id, status, trace_id, completed_by }]. status: 'PENDING' | 'COMPLETE' | 'DECLINED'. */
  listItems: async (queueId, { status } = {}) =>
    (await call(`/api/review-queue/queues/${q(queueId)}/items${status ? `?status=${q(status)}` : ''}`)).items,

  /** A queue's members (emails). Items have no per-item assignees yet, so these are the queue's reviewers. */
  listMembers: async (queueId) => (await call(`/api/review-queue/queues/${q(queueId)}/members`)).members,

  /**
   * One item with everything needed to review it:
   *   { item, trace: { trace_info, spans }, questions: [...], answers: { [question.title]: { value, rationale } } }
   * `answers` holds only this reviewer's own latest answers.
   */
  getItem: (queueId, itemId) => call(`/api/review-queue/queues/${q(queueId)}/items/${q(itemId)}`),

  /**
   * Save answers, keyed by question title: { [title]: { value, rationale? } }.
   * value: boolean (pass_fail), string (categorical, text), string[] (multi-select), number (numeric).
   * A new answer replaces this reviewer's earlier answer to the same question.
   */
  saveAnswers: (queueId, itemId, answers) =>
    call(`/api/review-queue/queues/${q(queueId)}/items/${q(itemId)}/answers`, 'PUT', { answers }),

  /** Set an item's status: 'PENDING' | 'COMPLETE' | 'DECLINED'. Returns the updated item. */
  setStatus: (queueId, itemId, status) =>
    call(`/api/review-queue/queues/${q(queueId)}/items/${q(itemId)}/status`, 'PUT', { status }),
};
