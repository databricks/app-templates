import type { AgentEvent } from "../types/events";
import { ApiError, failure } from "./api-client";

type InvocationBody = { id: string; session_id: string; input: Record<string, unknown> };

const TERMINAL = new Set(["run.completed", "run.failed"]);
const MAX_REPLAYS = 3;
const RETRY_MS = [1_000, 2_000, 4_000];
const IDLE_TIMEOUT_MS = 75_000;

function parseBlock(block: string): AgentEvent | null {
  let id = 0;
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { id, type, data: JSON.parse(data.join("\n")) } : null;
}

type ReadResult = { lastId: number; finished: boolean; dropped: boolean };

export class ConnectionLost extends Error {}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// Stream SSE frames, skip replayed events, detect dropped connection and idle timeout
async function readStream(
  path: string,
  init: RequestInit,
  onEvent: (event: AgentEvent) => void,
  after: number,
  signal: AbortSignal,
): Promise<ReadResult> {
  const attempt = new AbortController();
  const stop = () => attempt.abort();
  signal.addEventListener("abort", stop, { once: true });
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restartTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idle = true;
      attempt.abort();
    }, IDLE_TIMEOUT_MS);
  };
  let lastId = after;
  let finished = false;
  try {
    restartTimer();
    const response = await fetch(path, { ...init, signal: attempt.signal });
    if (!response.ok || !response.body) throw await failure(response);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      restartTimer();
      buffer += value.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        const isRepeat = event !== null && event.id > 0 && event.id <= lastId;
        if (event && !isRepeat) {
          lastId = Math.max(lastId, event.id);
          finished ||= TERMINAL.has(event.type);
          onEvent(event);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    if (idle) return { lastId, finished, dropped: false };
    if (error instanceof TypeError) return { lastId, finished, dropped: true };
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
  return { lastId, finished, dropped: false };
}

// Fetch events after given ID; server errors are treated as dropped connection
async function replay(
  id: string,
  headers: Record<string, string>,
  onEvent: (event: AgentEvent) => void,
  after: number,
  signal: AbortSignal,
): Promise<ReadResult> {
  try {
    return await readStream(`/api/invocations/${id}/events?after=${after}`, { headers }, onEvent, after, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return { lastId: after, finished: false, dropped: true };
    throw error;
  }
}

// Replay interrupted stream with exponential backoff; throw ConnectionLost if offline
async function follow(
  first: ReadResult,
  id: string,
  headers: Record<string, string>,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let result = first;
  let failures = 0;
  for (let attempt = 0; !result.finished && attempt < MAX_REPLAYS; attempt++) {
    if (result.dropped && !navigator.onLine) break;
    if (result.dropped) await pause(RETRY_MS[failures++], signal);
    result = await replay(id, headers, onEvent, result.lastId, signal);
  }
  if (result.finished) return;
  if (result.dropped) throw new ConnectionLost(`Invocation ${id} lost its connection before the run finished.`);
  throw new Error(`Invocation ${id} ended before the run finished, after ${MAX_REPLAYS} replays.`);
}

// Start invocation and stream to completion; retry 502 errors; abort stops reading only
export async function streamInvocation(
  body: InvocationBody,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const headers = { "Content-Type": "application/json", "X-Routing-Key": body.session_id };
  const init = { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }) };
  let first: ReadResult;
  try {
    first = await readStream("/api/invocations", init, onEvent, 0, signal);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 502)) throw error;
    first = await readStream("/api/invocations", init, onEvent, 0, signal);
  }
  await follow(first, body.id, headers, onEvent, signal);
}

// Resume run from given event ID, following until it ends
export async function resumeInvocation(
  id: string,
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
  after = 0,
): Promise<void> {
  const headers = { "X-Routing-Key": sessionId };
  const first = await replay(id, headers, onEvent, after, signal);
  await follow(first, id, headers, onEvent, signal);
}
