import {
  DefaultChatTransport,
  type HttpChatTransportInitOptions,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

/**
 * Extends the DefaultChatTransport to allow for a callback to be called when a stream part is received.
 * This is used to create a cursor that can be used to resume the stream from a specific point.
 */
export class ChatTransport<
  T extends UIMessage
> extends DefaultChatTransport<T> {
  private onStreamPart: ((part: UIMessageChunk) => void) | undefined;
  constructor(
    options?: HttpChatTransportInitOptions<T> & {
      onStreamPart: (part: UIMessageChunk) => void;
    }
  ) {
    const { onStreamPart, ...rest } = options ?? {};
    super(rest);
    this.onStreamPart = onStreamPart;
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
}
