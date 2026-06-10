import type { GenieStatementResponse } from '@databricks/appkit-ui/react';
import type {
  AttachmentQueryResult,
  ConversationSummary,
  FeedbackRating,
  SpaceInfo,
} from './types';

const BASE = '/api/genieAdvanced';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listSpaces(): Promise<SpaceInfo[]> {
  const data = await jsonFetch<{ spaces: SpaceInfo[] }>(`${BASE}/spaces`);
  return data.spaces;
}

export async function listConversations(
  alias: string,
  pageSize = 50,
): Promise<ConversationSummary[]> {
  const data = await jsonFetch<{
    conversations: ConversationSummary[];
    next_page_token?: string;
  }>(
    `${BASE}/spaces/${encodeURIComponent(alias)}/conversations?page_size=${pageSize}`,
  );
  return data.conversations;
}

export async function getAttachmentResult(
  alias: string,
  conversationId: string,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentQueryResult> {
  return jsonFetch<AttachmentQueryResult>(
    `${BASE}/spaces/${encodeURIComponent(alias)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/result`,
  );
}

export async function sendFeedback(
  alias: string,
  conversationId: string,
  messageId: string,
  rating: FeedbackRating,
): Promise<void> {
  await jsonFetch<void>(
    `${BASE}/spaces/${encodeURIComponent(alias)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify({ rating }),
    },
  );
}

export function statementResponseToCsv(
  response: GenieStatementResponse,
): string {
  const columns = response.manifest?.schema?.columns ?? [];
  const rows = response.result?.data_array ?? [];
  const header = columns.map((c) => csvEscape(c.name));
  const body = rows.map((row) =>
    row.map((cell) => csvEscape(cell ?? '')).join(','),
  );
  return [header.join(','), ...body].join('\n');
}

export function sdkAttachmentResultToCsv(result: AttachmentQueryResult): string {
  const columns =
    result.statement_response?.manifest?.schema?.columns ?? [];
  const rows = result.statement_response?.result?.data_array ?? [];
  const sorted = [...columns].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const header = sorted.map((c) => csvEscape(c.name));
  const body = rows.map((row) =>
    row.map((cell) => csvEscape(cell ?? '')).join(','),
  );
  return [header.join(','), ...body].join('\n');
}

function csvEscape(value: string): string {
  const needsQuote = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
