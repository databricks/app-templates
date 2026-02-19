/**
 * Direct agent app client - bypasses Databricks provider
 *
 * When calling a declarative agent app that uses OpenResponses format,
 * we need to:
 * 1. Format the request with simple string content (not Databricks parts format)
 * 2. Parse the OpenResponses SSE stream
 * 3. Convert to UIMessageStream format
 */

import type { ChatMessage } from './types';

export interface AgentAppRequest {
  url: string;
  messages: ChatMessage[];
  conversationId: string;
  userId: string;
  token?: string;
  headers?: Record<string, string>;
}

/**
 * Convert UI messages to agent app format
 */
function convertMessagesToAgentFormat(messages: ChatMessage[]) {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.parts
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n')
  }));
}

/**
 * Call agent app directly with correct format
 */
export async function callAgentApp(request: AgentAppRequest): Promise<Response> {
  const { url, messages, conversationId, userId, token, headers: customHeaders } = request;

  const requestBody = {
    input: convertMessagesToAgentFormat(messages),
    stream: true,
  };

  console.log('[AgentClient] Calling agent app:', {
    url,
    messageCount: messages.length,
    conversationId,
    userId,
    hasToken: !!token,
    hasCustomHeaders: !!customHeaders,
  });
  console.log('[AgentClient] Request body:', JSON.stringify(requestBody, null, 2));

  // Build headers - prefer custom headers (for user identity forwarding), fallback to token
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (token && !customHeaders) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
  });

  console.log('[AgentClient] Response received:', {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    cacheControl: response.headers.get('cache-control'),
    connection: response.headers.get('connection'),
    transferEncoding: response.headers.get('transfer-encoding'),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[AgentClient] Error response:', errorText.substring(0, 500));
    throw new Error(`Agent app returned ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // Check if we got HTML instead of SSE (login page)
  if (contentType.includes('text/html')) {
    const htmlPreview = await response.clone().text();
    console.error('[AgentClient] ❌ Received HTML instead of SSE!');
    console.error('[AgentClient] HTML preview:', htmlPreview.substring(0, 300));
    throw new Error('Received HTML login page - authentication failed');
  }

  // Check if we got SSE
  if (!contentType.includes('text/event-stream')) {
    console.warn('[AgentClient] ⚠️ Content-Type is not text/event-stream!');
    console.warn('[AgentClient] Attempting to parse anyway...');
    // If not SSE, log the response body for debugging
    const responseClone = response.clone();
    const text = await responseClone.text();
    console.log('[AgentClient] Non-SSE response body (first 500 chars):', text.substring(0, 500));
  }

  return response;
}

/**
 * Parse OpenResponses SSE stream and convert to text chunks
 */
export async function* parseOpenResponsesStream(
  response: Response
): AsyncGenerator<string> {
  if (!response.body) {
    console.error('[AgentClient] Response has no body!');
    throw new Error('Response has no body');
  }

  console.log('[AgentClient] Response details:', {
    status: response.status,
    contentType: response.headers.get('content-type'),
    hasBody: !!response.body,
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lineCount = 0;
  let eventCount = 0;
  let deltaCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('[AgentClient] Stream done. Stats:', {
        linesProcessed: lineCount,
        eventsReceived: eventCount,
        deltaEventsFound: deltaCount,
      });
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      lineCount++;

      if (!line.startsWith('data: ')) {
        console.log('[AgentClient] Non-data line:', line.substring(0, 50));
        continue;
      }

      const data = line.slice(6);
      if (data === '[DONE]') {
        console.log('[AgentClient] Received [DONE] marker');
        return;
      }

      try {
        const event = JSON.parse(data);
        eventCount++;

        console.log(`[AgentClient] Event ${eventCount}:`, {
          type: event.type,
          hasDelta: !!event.delta,
          deltaLength: event.delta?.length,
          eventKeys: Object.keys(event),
        });

        if (event.type === 'response.output_text.delta' && event.delta) {
          deltaCount++;
          console.log(`[AgentClient] ✓ Delta ${deltaCount}: "${event.delta}"`);
          yield event.delta;
        } else if (event.type === 'response.error') {
          console.error('[AgentClient] Error event:', event.error);
          throw new Error(event.error?.message || 'Agent app error');
        } else {
          console.log('[AgentClient] Ignoring event type:', event.type);
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          console.warn('[AgentClient] Failed to parse SSE event:', data.substring(0, 100));
        } else {
          throw e;
        }
      }
    }
  }
}
