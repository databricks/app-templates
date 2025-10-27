import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { chat, type User, message, type DBMessage, type Chat } from "./schema";
import type { VisibilityType } from "@chat-template/core";
import { ChatSDKError } from "@chat-template/core";
import type { LanguageModelV2Usage } from "@ai-sdk/provider";
import { isDatabaseAvailable } from "./connection";
import { getAuthMethod, getAuthMethodDescription } from "@chat-template/auth";

// Re-export User type for external use
export type { User } from "./schema";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle
let db: ReturnType<typeof drizzle>;

if (!isDatabaseAvailable()) {
  throw new Error(
    "Database configuration required. Please set PGDATABASE/PGHOST/PGUSER or POSTGRES_URL environment variables."
  );
}

const authMethod = getAuthMethod();
if (authMethod === "oauth" || authMethod === "cli") {
  // Dynamic auth path - db will be initialized asynchronously
  console.log(
    `Using ${getAuthMethodDescription()} authentication for Postgres connection`
  );
} else if (process.env.POSTGRES_URL) {
  // Traditional connection string
  const client = postgres(process.env.POSTGRES_URL);
  db = drizzle(client);
}

// Helper to ensure db is initialized for dynamic auth connections
async function ensureDb() {
  // Always get a fresh DB instance for dynamic auth connections to handle token expiry
  const authMethod = getAuthMethod();
  if (authMethod === "oauth" || authMethod === "cli") {
    const authDescription = getAuthMethodDescription();
    console.log(`[ensureDb] Getting ${authDescription} database connection...`);
    try {
      // Import getDb for database connection
      const { getDb } = await import("./connection-pool.js");
      const database = await getDb();
      console.log(
        `[ensureDb] ${authDescription} db connection obtained successfully`
      );
      return database;
    } catch (error) {
      console.error(
        `[ensureDb] Failed to get ${authDescription} connection:`,
        error
      );
      throw error;
    }
  }

  // For static connections (POSTGRES_URL), use cached instance
  if (!db) {
    console.error("[ensureDb] DB is still null after initialization attempt!");
    throw new Error("Database connection could not be established");
  }
  return db;
}

export async function getUserFromHeaders({
  getRequestHeader,
}: {
  getRequestHeader: (name: string) => string | null;
}): Promise<User> {
  // Check for Databricks Apps headers first
  const forwardedUser = getRequestHeader("X-Forwarded-User");
  const forwardedEmail = getRequestHeader("X-Forwarded-Email");
  const forwardedPreferredUsername = getRequestHeader("X-Forwarded-Preferred-Username");

  let user: User;
  if (forwardedUser) {
    // Databricks Apps environment - use forwarded headers
    user = {
      id: forwardedUser,
      email: forwardedEmail || `${forwardedPreferredUsername ?? forwardedUser}@databricks.com`,
    };
  } else {
    // Local development - use system username
    user = {
      id: process.env.USER || process.env.USERNAME || "local-user",
      email: `${process.env.USER || process.env.USERNAME || "local-user"}@localhost`,
    }
  }

  console.log(`[getUserFromHeaders] Returning user from headers:`, user);
  return user;
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
  try {
    return await (await ensureDb()).insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (error) {
    console.error("[saveChat] Error saving chat:", error);
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await (await ensureDb()).delete(message).where(eq(message.chatId, id));

    const [chatsDeleted] = await (await ensureDb())
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
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
    const extendedLimit = limit + 1;

    const query = async (whereCondition?: SQL<any>) => {
      const database = await ensureDb();

      return database
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);
    };

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const database = await ensureDb();
      const [selectedChat] = await database
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const database = await ensureDb();
      const [selectedChat] = await database
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    console.error("[getChatsByUserId] Error details:", error);
    console.error(
      "[getChatsByUserId] Error stack:",
      error instanceof Error ? error.stack : "No stack available"
    );
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
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
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await (await ensureDb()).insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await (await ensureDb())
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await (await ensureDb())
      .select()
      .from(message)
      .where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
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
  try {
    const messagesToDelete = await (
      await ensureDb()
    )
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      return await (await ensureDb())
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await (await ensureDb())
      .update(chat)
      .set({ visibility })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat visibility by id"
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
  try {
    return await (await ensureDb())
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update lastContext for chat", chatId, error);
    return;
  }
}
