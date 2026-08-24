import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { buildSaveMessagesQuery } from '@chat-template/db';

test('assistant continuation upsert keeps an existing trace when the update has no trace', () => {
  const database = drizzle({} as never);
  const query = buildSaveMessagesQuery(database, [
    {
      id: '00000000-0000-4000-8000-000000000000',
      chatId: '10000000-0000-4000-8000-000000000000',
      role: 'assistant',
      parts: [{ type: 'dynamic-tool', state: 'output-denied' }],
      attachments: [],
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      traceId: null,
    },
  ]);

  expect(query.toSQL().sql).toContain(
    '"traceId" = coalesce(excluded."traceId", "ai_chatbot"."Message"."traceId")',
  );
});
