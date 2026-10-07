/**
 * In-memory stream cache for resumable streams.
 *
 * This provides a simple in-memory alternative to Redis for stream resumption.
 * Streams are stored with a TTL and automatically cleaned up.
 *
 * Note: This is not suitable for distributed deployments. For production
 * with multiple instances, use Redis or another distributed cache.
 */

import { Readable } from 'node:stream';

interface CachedStream {
  chatId: string;
  streamId: string;
  cache: CacheableStream<string>;
  createdAt: number;
  lastAccessedAt: number;
}
export class StreamCache {
  private cache = new Map<string, CachedStream>();
  private activeStreams = new Map<string, string>(); // chatId -> streamId
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.log('[StreamCache] constructor');
    // Start cleanup interval to remove expired streams
    this.startCleanup();
  }

  private startCleanup() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expiredKeys: string[] = [];

      for (const [streamId, stream] of this.cache.entries()) {
        if (now - stream.lastAccessedAt > this.TTL_MS) {
          expiredKeys.push(streamId);
        }
      }

      for (const streamId of expiredKeys) {
        const stream = this.cache.get(streamId);
        if (stream) {
          this.activeStreams.delete(stream.chatId);
          this.clearStream(streamId);
          console.log(
            `[StreamCache] Expired stream ${streamId} for chat ${stream.chatId}`,
          );
        }
      }

      if (expiredKeys.length > 0) {
        console.log(
          `[StreamCache] Cleaned up ${expiredKeys.length} expired streams`,
        );
      }
    }, 60 * 1000); // Check every minute
  }

  /**
   * Store a stream
   */
  storeStream({
    streamId,
    chatId,
    stream,
  }: {
    streamId: string;
    chatId: string;
    stream: ReadableStream<string>;
  }) {
    console.log('[StreamCache] storeStream', streamId, chatId);
    this.activeStreams.set(chatId, streamId);
    const entry = {
      chatId,
      streamId,
      cache: makeCacheableStream({
        source: stream,
        onPush: () => {
          entry.lastAccessedAt = Date.now();
        },
      }),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    this.cache.set(streamId, entry);
  }

  /**
   * Get a stream (returns a Node.js Readable stream for direct use with Express)
   */
  getStream(
    streamId: string,
    { cursor }: { cursor?: number } = {},
  ): Readable | null {
    const cache = this.cache.get(streamId)?.cache;
    if (!cache) return null;
    return cacheableToReadable(cache, { cursor });
  }
  /**
   * Get the active stream ID for a chat
   */
  getActiveStreamId(chatId: string): string | null {
    return this.activeStreams.get(chatId) ?? null;
  }

  /**
   * Clear the active stream for a chat (e.g., when starting a new message)
   */
  clearActiveStream(chatId: string): void {
    const streamId = this.activeStreams.get(chatId);
    if (streamId) {
      this.activeStreams.delete(chatId);
      console.log(
        `[StreamCache] Cleared active stream ${streamId} for chat ${chatId}`,
      );
    }
  }

  clearStream(streamId: string): void {
    const stream = this.cache.get(streamId);
    if (stream) {
      stream.cache.close();
      this.cache.delete(streamId);
    }
  }
}

interface CacheableStream<T> {
  readonly chunks: readonly T[];
  read({ cursor }: { cursor?: number }): AsyncIterableIterator<T>;
  close(): void;
}

/**
 * Turns an arbitrary `ReadableStream<T>` into a cache‑able
 * async‑iterable.  All data is stored as T[].
 *
 * @param source The original readable stream you want to cache.
 * @param onPush A callback to be called when a chunk is pushed to the stream.
 * @returns An object matching the `CacheableStream` interface.
 */
function makeCacheableStream<T>({
  source,
  onPush,
}: {
  source: ReadableStream<T>;
  onPush?: (chunk: T) => void;
}): CacheableStream<T> {
  // -----------------------------------------------------------------
  //  Internal state
  // -----------------------------------------------------------------
  const chunks: T[] = []; // cached chunks
  let done = false; // true when source ends or close() called
  const waiters: (() => void)[] = []; // pending promises awaiting more data

  // -----------------------------------------------------------------
  //  Helper: wake up every reader that is waiting for more data.
  // -----------------------------------------------------------------
  const notify = () => {
    // Resolve all current waiters, then clear the array.
    const current = [...waiters];
    waiters.length = 0;
    current.forEach((resolve) => resolve());
  };

  // -----------------------------------------------------------------
  //  Background consumer – reads the source exactly once.
  // -----------------------------------------------------------------
  (async () => {
    const reader = source.getReader();

    try {
      while (true) {
        const { value, done: srcDone } = await reader.read();
        if (srcDone) break; // source finished
        // Convert the Uint8Array to a string and cache it.
        chunks.push(value);
        onPush?.(value);
        notify(); // wake any pending readers
      }
    } catch (err) {
      // In a real‑world library you probably want to surface the error.
      // For this simple example we just treat it as an early termination.
      console.error('CacheableStream source error:', err);
    } finally {
      done = true; // mark the stream as finished
      notify(); // unblock readers that are waiting for data
      reader.releaseLock();
    }
  })();

  // -----------------------------------------------------------------
  //  Public API
  // -----------------------------------------------------------------
  const api: CacheableStream<T> = {
    // expose a **read‑only** view of the internal array
    get chunks() {
      return chunks as readonly T[];
    },

    // The core async generator – see the comments inside for details.
    async *read({ cursor }: { cursor?: number } = {}) {
      let idx = cursor ?? 0; // where we are in the cache for this particular call

      while (true) {
        // 1️⃣ Yield everything that is already cached and we haven't emitted yet.
        while (idx < chunks.length) {
          yield chunks[idx++];
        }

        // 2️⃣ If the source has finished, we are done.
        if (done) {
          return;
        }

        // 3️⃣ Otherwise wait for *more* data.
        await new Promise<void>((resolve) => waiters.push(resolve));
        // Loop again – now `chunks.length` will be larger, so the inner
        // while‑loop will yield the newly arrived chunk(s).
      }
    },

    // Explicitly close the stream (useful if you want to stop early).
    close() {
      done = true;
      notify(); // unblock any pending read() callers
    },
  };

  return api;
}

/**
 * Turns a `CacheableStream<T>` into a Node.js `Readable` stream
 *
 * The stream pulls data from the cached async generator (`cache.read()`),
 * honors backpressure, and is directly compatible with Express responses.
 *
 * Optimized for concurrent streams by:
 * - Using non-blocking iteration
 * - Batching multiple chunks when available
 * - Avoiding blocking async/await in read()
 */
function cacheableToReadable<T>(
  cache: CacheableStream<T>,
  { cursor }: { cursor?: number } = {},
): Readable {
  let iterator: AsyncIterableIterator<T> | undefined;
  let pendingRead: Promise<IteratorResult<T>> | null = null;
  let isReading = false;

  return new Readable({
    // Set highWaterMark to control internal buffer size
    // This prevents excessive memory usage with many concurrent streams
    highWaterMark: 16 * 1024, // 16KB buffer per stream

    read() {
      // Prevent overlapping reads
      if (isReading) return;
      isReading = true;

      // Initialize iterator on first read
      if (!iterator) {
        iterator = cache.read({ cursor });
      }

      // Start async read and process when ready
      const processNext = async () => {
        try {
          while (true) {
            // Start fetching next chunk if not already pending
            if (!pendingRead) {
              pendingRead = iterator?.next() ?? null;
            }
            if (!pendingRead) {
              break;
            }

            const { value, done } = await pendingRead;
            pendingRead = null;

            if (done) {
              // No more data - signal end of stream
              this.push(null);
              break;
            }

            // Try to push chunk - if push returns false, backpressure is applied
            // and we'll wait for the next read() call
            const canContinue = this.push(value);

            if (!canContinue) {
              // Backpressure - stop pushing and wait for next read() call
              break;
            }

            // If we can continue, start fetching the next chunk immediately
            // This optimizes throughput by overlapping I/O
            pendingRead = iterator?.next() ?? null;
          }
        } catch (err) {
          // Propagate any unexpected error to the consumer
          this.destroy(err as Error);
        } finally {
          isReading = false;
        }
      };

      // Don't await - let it run asynchronously
      processNext();
    },

    destroy(error, callback) {
      if (error) {
        console.log(
          '[StreamCache] Stream destroyed with error:',
          error.message,
        );
      }
      // We don't close the underlying cache when this is destroyed
      // since new consumers may be started
      callback(error);
    },
  });
}
