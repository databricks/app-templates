import {
  generateText,
  type LanguageModelUsage,
  type UIMessageStreamWriter,
} from 'ai';
import { generateUUID } from '@chat-template/core';

/**
 * Reads all chunks from a UI message stream, forwarding non-error parts to the
 * writer. Returns whether the stream encountered any errors.
 */
export async function drainStreamToWriter(
  uiStream: ReadableStream,
  writer: UIMessageStreamWriter,
): Promise<{ failed: boolean; errorText?: string }> {
  const reader = uiStream.getReader();
  let receivedTextChunk = false;

  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      if (chunk.value.type === 'error') {
        if (!receivedTextChunk) {
          console.error(
            'Error before first text chunk, triggering fallback:',
            chunk.value.errorText,
          );
          return { failed: true, errorText: chunk.value.errorText };
        }
        console.error(
          'Mid-stream error, forwarding to client:',
          chunk.value.errorText,
        );
        writer.write(chunk.value);
      } else {
        if (!receivedTextChunk && chunk.value.type.startsWith('text-')) {
          receivedTextChunk = true;
        }
        writer.write(chunk.value);
      }
    }
  } catch (readError) {
    if (!receivedTextChunk) {
      console.error('Stream read error before first text chunk:', readError);
      return { failed: true };
    }
    console.error('Mid-stream read error:', readError);
  }

  return { failed: false };
}

/**
 * Converts a generateText result's content array into UIMessageChunks and
 * writes them to the stream writer. This is the non-streaming equivalent of
 * streamText's toUIMessageStream: it walks the unified `content` array and
 * emits the matching chunk types so the client sees the same parts regardless
 * of whether the response was streamed or generated as a whole.
 *
 * The ContentPart → UIMessageChunk mapping mirrors the transform in the AI SDK's
 * streamText().toUIMessageStream() (ai/src/generate-text/stream-text.ts). All
 * content part types are handled:
 *   text       → text-start / text-delta / text-end
 *   reasoning  → reasoning-start / reasoning-delta / reasoning-end
 *   file       → file  (data URL, same as the SDK streaming path)
 *   source     → source-url | source-document
 *   tool-call  → tool-input-available
 *   tool-result→ tool-output-available
 *   tool-error, tool-approval-request → ignored (not expected in fallback)
 */
function writeGenerateTextResultToStream(
  result: Awaited<ReturnType<typeof generateText>>,
  writer: UIMessageStreamWriter,
) {
  for (const part of result.content) {
    const id = generateUUID();

    switch (part.type) {
      case 'text': {
        if (part.text.length > 0) {
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: part.text });
          writer.write({ type: 'text-end', id });
        }
        break;
      }
      case 'reasoning': {
        if (part.text.length > 0) {
          writer.write({ type: 'reasoning-start', id });
          writer.write({ type: 'reasoning-delta', id, delta: part.text });
          writer.write({ type: 'reasoning-end', id });
        }
        break;
      }
      case 'file': {
        writer.write({
          type: 'file',
          mediaType: part.file.mediaType,
          url: `data:${part.file.mediaType};base64,${part.file.base64}`,
        });
        break;
      }
      case 'source': {
        if (part.sourceType === 'url') {
          writer.write({
            type: 'source-url',
            sourceId: part.id,
            url: part.url,
            title: part.title,
            ...(part.providerMetadata != null
              ? { providerMetadata: part.providerMetadata }
              : {}),
          });
        } else if (part.sourceType === 'document') {
          writer.write({
            type: 'source-document',
            sourceId: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            ...(part.providerMetadata != null
              ? { providerMetadata: part.providerMetadata }
              : {}),
          });
        }
        break;
      }
      case 'tool-call': {
        writer.write({
          type: 'tool-input-available',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      }
      case 'tool-result': {
        writer.write({
          type: 'tool-output-available',
          toolCallId: part.toolCallId,
          output: part.output,
        });
        break;
      }
      default:
        break;
    }
  }

  writer.write({ type: 'finish', finishReason: result.finishReason });
}

/**
 * Falls back to a non-streaming generateText call and writes the result as
 * stream parts via writeGenerateTextResultToStream.
 * Returns the usage on success, or undefined if the fallback itself fails.
 */
export async function fallbackToGenerateText(
  params: Parameters<typeof generateText>[0],
  writer: UIMessageStreamWriter,
): Promise<{ usage: LanguageModelUsage; traceId?: string } | undefined> {
  try {
    const fallback = await generateText(params);

    const traceId = (fallback?.response?.body as {
      metadata: {
        trace_id: string;
      };
    })?.metadata?.trace_id;

    writeGenerateTextResultToStream(fallback, writer);

    return { usage: fallback.usage, traceId };
  } catch (fallbackError) {
    console.error('[fallbackToGenerateText] generateText fallback also failed:', fallbackError);
    const errorMessage =
      fallbackError instanceof Error
        ? fallbackError.message
        : String(fallbackError);
    writer.write({ type: 'data-error', data: errorMessage });
    return undefined;
  }
}
