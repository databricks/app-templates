import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/databricks/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';
import { formatISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

/**
 * Fetch wrapper with retry logic for handling streaming timeouts
 * Automatically retries on connection errors with exponential backoff
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: {
    maxRetries?: number;
    initialRetryDelay?: number;
    maxRetryDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<Response> {
  const {
    maxRetries = 5,
    initialRetryDelay = 1000,
    maxRetryDelay = 10000,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithErrorHandlers(input, init);
      return response;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (4xx) or offline errors
      if (
        error instanceof ChatSDKError &&
        (error.code.startsWith('bad_request') ||
          error.code.startsWith('unauthorized') ||
          error.code.startsWith('forbidden') ||
          error.code.startsWith('offline'))
      ) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        initialRetryDelay * Math.pow(2, attempt),
        maxRetryDelay,
      );

      console.log(
        `[fetchWithRetry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
        lastError.message,
      );

      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // If we exhausted all retries, throw the last error
  throw lastError || new Error('All retry attempts failed');
}

function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = CoreToolMessage | CoreAssistantMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

function getMostRecentUserMessage(messages: Array<UIMessage>) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number,
) {
  if (!documents) return new Date();
  if (index > documents.length) return new Date();

  return documents[index].createdAt;
}

function getTrailingMessageId({
  messages,
}: {
  messages: Array<ResponseMessage>;
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) return null;

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
