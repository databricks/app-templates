import {
  DefaultChatTransport,
  type HttpChatTransportInitOptions,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

/**
 * IDs of parts that are currently streaming and haven't received their end event.
 * Used to restore AI SDK internal trackers on stream resumption.
 */
export interface StreamingPartIds {
  reasoning?: string;
  text?: string;
  toolInput?: string;
}

/**
 * Extends the DefaultChatTransport to:
 * 1. Allow a callback when stream parts are received (for cursor tracking)
 * 2. Inject synthetic start events on stream resumption for open streaming parts
 *
 * When a stream is interrupted mid-reasoning/text/tool-input, the AI SDK's internal
 * trackers are reset on reconnect. This causes errors when delta chunks arrive
 * without their corresponding start events. We solve this by:
 * - Tracking which parts are currently streaming via onStreamPart
 * - On reconnect, injecting synthetic *-start events before the resumed stream
 */
export class ChatTransport<
  T extends UIMessage
> extends DefaultChatTransport<T> {
  private onStreamPart: ((part: UIMessageChunk) => void) | undefined;
  private getStreamingPartIds: (() => StreamingPartIds) | undefined;

  constructor(
    options?: HttpChatTransportInitOptions<T> & {
      onStreamPart?: (part: UIMessageChunk) => void;
      /**
       * Returns the IDs of parts that are currently streaming.
       * Called before processing resumed stream to inject synthetic start events.
       */
      getStreamingPartIds?: () => StreamingPartIds;
    }
  ) {
    const { onStreamPart, getStreamingPartIds, ...rest } = options ?? {};
    super(rest);
    this.onStreamPart = onStreamPart;
    this.getStreamingPartIds = getStreamingPartIds;
  }

  protected processResponseStream(
    stream: ReadableStream<Uint8Array<ArrayBufferLike>>
  ): ReadableStream<UIMessageChunk> {
    const onStreamPart = this.onStreamPart;
    const processedStream = super.processResponseStream(stream);
    return processedStream.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          onStreamPart?.(chunk);
          controller.enqueue(chunk);
        },
      })
    );
  }

  /**
   * Override reconnectToStream to inject synthetic start events for open streaming parts.
   * This restores the AI SDK's internal trackers so delta chunks work correctly.
   */
  async reconnectToStream(
    options: Parameters<DefaultChatTransport<T>["reconnectToStream"]>[0]
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const resumedStream = await super.reconnectToStream(options);

    if (!resumedStream) {
      return null;
    }

    // Get IDs of parts that were streaming when we disconnected
    const openParts = this.getStreamingPartIds?.() ?? {};
    const syntheticChunks: UIMessageChunk[] = [];

    // Create synthetic start events for each open part type
    // Order matters: reasoning -> text -> tool-input (typical stream order)
    if (openParts.reasoning) {
      syntheticChunks.push({
        type: "reasoning-start",
        id: openParts.reasoning,
      } as UIMessageChunk);
    }
    if (openParts.text) {
      syntheticChunks.push({
        type: "text-start",
        id: openParts.text,
      } as UIMessageChunk);
    }
    if (openParts.toolInput) {
      syntheticChunks.push({
        type: "tool-input-start",
        id: openParts.toolInput,
        // tool-input-start requires toolName, but we don't have it stored
        // The AI SDK should handle this gracefully since the part already exists
        toolName: "",
      } as UIMessageChunk);
    }

    // If no open parts, return the stream as-is
    if (syntheticChunks.length === 0) {
      return resumedStream;
    }

    // Prepend synthetic chunks to the resumed stream
    return this.prependChunksToStream(syntheticChunks, resumedStream);
  }

  /**
   * Creates a new stream that emits the given chunks before the original stream.
   */
  private prependChunksToStream(
    chunks: UIMessageChunk[],
    stream: ReadableStream<UIMessageChunk>
  ): ReadableStream<UIMessageChunk> {
    const reader = stream.getReader();
    let syntheticIndex = 0;
    const onStreamPart = this.onStreamPart;

    return new ReadableStream<UIMessageChunk>({
      async pull(controller) {
        // First emit all synthetic chunks
        while (syntheticIndex < chunks.length) {
          const chunk = chunks[syntheticIndex++];
          onStreamPart?.(chunk);
          controller.enqueue(chunk);
        }

        // Then read from the original stream
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      cancel(reason) {
        reader.cancel(reason);
      },
    });
  }
}
