import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { chat, message, feedback, type DBMessage, type Chat } from './schema';
import type { VisibilityType } from '@chat-template/utils';
import { ChatSDKError } from '@chat-template/core/errors';
import type { LanguageModelV2Usage } from '@ai-sdk/provider';
import { isDatabaseAvailable } from './connection';
import { getAuthMethod, getAuthMethodDescription } from '@chat-template/auth';

// Re-export User type for external use
export type { User } from './schema';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle
let _db: ReturnType<typeof drizzle>;

const getOrInitializeDb = async () => {
  if (!isDatabaseAvailable()) {
    throw new Error(
      'Database configuration required. Please set PGDATABASE/PGHOST/PGUSER or POSTGRES_URL environment variables.',
    );
  }

  if (_db) return _db;

  const authMethod = getAuthMethod();
  if (authMethod === 'oauth' || authMethod === 'cli') {
    // Dynamic auth path - db will be initialized asynchronously
    console.log(
      `Using ${getAuthMethodDescription()} authentication for Postgres connection`,
    );
  } else if (process.env.POSTGRES_URL) {
    // Traditional connection string
    const client = postgres(process.env.POSTGRES_URL);
    _db = drizzle(client);
  }

  return _db;
};

// Helper to ensure db is initialized for dynamic auth connections
async function ensureDb() {
  const db = await getOrInitializeDb();
  // Always get a fresh DB instance for dynamic auth connections to handle token expiry
  const authMethod = getAuthMethod();
  if (authMethod === 'oauth' || authMethod === 'cli') {
    const authDescription = getAuthMethodDescription();
    console.log(`[ensureDb] Getting ${authDescription} database connection...`);
    try {
      // Import getDb for database connection
      const { getDb } = await import('./connection-pool.js');
      const database = await getDb();
      console.log(
        `[ensureDb] ${authDescription} db connection obtained successfully`,
      );
      return database;
    } catch (error) {
      console.error(
        `[ensureDb] Failed to get ${authDescription} connection:`,
        error,
      );
      throw error;
    }
  }

  // For static connections (POSTGRES_URL), use cached instance
  if (!db) {
    console.error('[ensureDb] DB is still null after initialization attempt!');
    throw new Error('Database connection could not be established');
  }
  return db;
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  if (!isDatabaseAvailable()) {
    console.log('[saveChat] Database not available, skipping persistence');
    return;
  }

  try {
    return await (await ensureDb()).insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (error) {
    console.error('[saveChat] Error saving chat:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }) {
  if (!isDatabaseAvailable()) {
    console.log('[deleteChatById] Database not available, skipping deletion');
    return null;
  }

  try {
    await (await ensureDb()).delete(message).where(eq(message.chatId, id));

    const [chatsDeleted] = await (await ensureDb())
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id',
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  if (!isDatabaseAvailable()) {
    console.log('[getChatsByUserId] Database not available, returning empty');
    return { chats: [], hasMore: false };
  }

  try {
    const extendedLimit = limit + 1;

    const query = async (whereCondition?: SQL<any>) => {
      const database = await ensureDb();

      return database
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);
    };

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      console.log(
        '[getChatsByUserId] Fetching chat for startingAfter:',
        startingAfter,
      );
      const database = await ensureDb();
      const [selectedChat] = await database
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${startingAfter} not found`,
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      console.log(
        '[getChatsByUserId] Fetching chat for endingBefore:',
        endingBefore,
      );
      const database = await ensureDb();
      const [selectedChat] = await database
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${endingBefore} not found`,
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      console.log('[getChatsByUserId] Executing main query without pagination');
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;
    console.log(
      '[getChatsByUserId] Query successful, found',
      filteredChats.length,
      'chats',
    );

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    console.error('[getChatsByUserId] Error details:', error);
    console.error(
      '[getChatsByUserId] Error stack:',
      error instanceof Error ? error.stack : 'No stack available',
    );
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chats by user id',
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  if (!isDatabaseAvailable()) {
    console.log('[getChatById] Database not available, returning null');
    return null;
  }

  try {
    const [selectedChat] = await (await ensureDb())
      .select()
      .from(chat)
      .where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  if (!isDatabaseAvailable()) {
    console.log('[saveMessages] Database not available, skipping persistence');
    return;
  }

  try {
    // Use upsert to handle both new messages and updates (e.g., MCP approval continuations)
    // When a message ID already exists, update its parts (which may have changed)
    // Using sql`excluded.X` to reference the values that would have been inserted
    return await (await ensureDb())
      .insert(message)
      .values(messages)
      .onConflictDoUpdate({
        target: message.id,
        set: {
          parts: sql`excluded.parts`,
          attachments: sql`excluded.attachments`,
        },
      });
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[getMessagesByChatId] Database not available, returning empty',
    );
    return [];
  }

  try {
    return await (await ensureDb())
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id',
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  if (!isDatabaseAvailable()) {
    console.log('[getMessageById] Database not available, returning empty');
    return [];
  }

  try {
    return await (await ensureDb())
      .select()
      .from(message)
      .where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id',
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[deleteMessagesByChatIdAfterTimestamp] Database not available, skipping deletion',
    );
    return;
  }

  try {
    const messagesToDelete = await (await ensureDb())
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      return await (await ensureDb())
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp',
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[updateChatVisiblityById] Database not available, skipping update',
    );
    return;
  }

  try {
    return await (await ensureDb())
      .update(chat)
      .set({ visibility })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id',
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  // Store raw LanguageModelUsage to keep it simple
  context: LanguageModelV2Usage;
}) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[updateChatLastContextById] Database not available, skipping update',
    );
    return;
  }

  try {
    return await (await ensureDb())
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn('Failed to update lastContext for chat', chatId, error);
    return;
  }
}

// Feedback operations

export async function createFeedback({
  messageId,
  chatId,
  userId,
  feedbackType,
  mlflowAssessmentId,
}: {
  messageId: string;
  chatId: string;
  userId: string;
  feedbackType: 'thumbs_up' | 'thumbs_down';
  mlflowAssessmentId?: string;
}) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[createFeedback] Database not available, skipping persistence',
    );
    return null;
  }

  try {
    const [result] = await (await ensureDb())
      .insert(feedback)
      .values({
        messageId,
        chatId,
        userId,
        feedbackType,
        mlflowAssessmentId: mlflowAssessmentId || null,
        createdAt: new Date(),
        updatedAt: null,
      })
      .returning();

    return result;
  } catch (error) {
    console.error('[createFeedback] Error creating feedback:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to create feedback');
  }
}

export async function getFeedbackByMessageId({
  messageId,
}: {
  messageId: string;
}) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[getFeedbackByMessageId] Database not available, returning null',
    );
    return null;
  }

  try {
    const [result] = await (await ensureDb())
      .select()
      .from(feedback)
      .where(eq(feedback.messageId, messageId))
      .limit(1);

    return result || null;
  } catch (error) {
    console.error('[getFeedbackByMessageId] Error getting feedback:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get feedback by message id',
    );
  }
}

export async function getFeedbackByChatId({ chatId }: { chatId: string }) {
  if (!isDatabaseAvailable()) {
    console.log(
      '[getFeedbackByChatId] Database not available, returning empty',
    );
    return [];
  }

  try {
    return await (await ensureDb())
      .select()
      .from(feedback)
      .where(eq(feedback.chatId, chatId))
      .orderBy(asc(feedback.createdAt));
  } catch (error) {
    console.error('[getFeedbackByChatId] Error getting feedback:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get feedback by chat id',
    );
  }
}

export async function updateFeedback({
  id,
  feedbackType,
  mlflowAssessmentId,
}: {
  id: string;
  feedbackType?: 'thumbs_up' | 'thumbs_down';
  mlflowAssessmentId?: string;
}) {
  if (!isDatabaseAvailable()) {
    console.log('[updateFeedback] Database not available, skipping update');
    return null;
  }

  try {
    const updateData: {
      feedbackType?: 'thumbs_up' | 'thumbs_down';
      mlflowAssessmentId?: string;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (feedbackType !== undefined) {
      updateData.feedbackType = feedbackType;
    }

    if (mlflowAssessmentId !== undefined) {
      updateData.mlflowAssessmentId = mlflowAssessmentId;
    }

    const [result] = await (await ensureDb())
      .update(feedback)
      .set(updateData)
      .where(eq(feedback.id, id))
      .returning();

    return result;
  } catch (error) {
    console.error('[updateFeedback] Error updating feedback:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to update feedback');
  }
}

export async function deleteFeedback({ id }: { id: string }) {
  if (!isDatabaseAvailable()) {
    console.log('[deleteFeedback] Database not available, skipping deletion');
    return null;
  }

  try {
    const [result] = await (await ensureDb())
      .delete(feedback)
      .where(eq(feedback.id, id))
      .returning();

    return result;
  } catch (error) {
    console.error('[deleteFeedback] Error deleting feedback:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to delete feedback');
  }
}
