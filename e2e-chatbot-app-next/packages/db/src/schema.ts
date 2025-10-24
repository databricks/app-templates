import type { InferSelectModel } from 'drizzle-orm';
import {
  varchar,
  timestamp,
  json,
  jsonb,
  uuid,
  text,
  pgSchema,
} from 'drizzle-orm/pg-core';
import type { LanguageModelV2Usage } from '@ai-sdk/provider';

const schemaName = 'ai_chatbot';
console.log(`[Schema] Using database schema: ${schemaName}`);
const customSchema = pgSchema(schemaName);

// // Helper function to create table with proper schema handling
//   // Use the schema object for proper drizzle-kit migration generation
const createTable = customSchema.table;

export const user = createTable('User', {
  id: text('id').primaryKey().notNull(),
  email: varchar('email', { length: 64 }).notNull(),
  // Password removed - using Databricks SSO authentication
});

export type User = InferSelectModel<typeof user>;

export const chat = createTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: text('userId').notNull(),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  lastContext: jsonb('lastContext').$type<LanguageModelV2Usage | null>(),
});

export type Chat = InferSelectModel<typeof chat>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const messageDeprecated = createTable('Message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  content: json('content').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type MessageDeprecated = InferSelectModel<typeof messageDeprecated>;

export const message = createTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;
