import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Model = {
  id: string;
  name: string;
  images: boolean;
  context_window: number;
};

export type Me = { email: string; user_name: string; display_name: string | null };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`HTTP ${status}${code ? ` ${code}` : ""}`);
  }
}

let signOutReference: string | null = null;
const signOutListeners = new Set<() => void>();

function supportReference(status: number, code: string | null): string {
  return code ? code.replace(/^MCP_/, "").replaceAll("_", "-") : String(status);
}

// Convert error response to ApiError; 401 signs out entire app
export async function failure(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  const code = typeof body?.error?.code === "string" ? body.error.code : null;
  if (response.status === 401 && signOutReference === null) {
    signOutReference = supportReference(response.status, code);
    for (const listener of signOutListeners) listener();
  }
  return new ApiError(response.status, code);
}

export function useSignOutReference(): string | null {
  return useSyncExternalStore(
    (listener) => {
      signOutListeners.add(listener);
      return () => signOutListeners.delete(listener);
    },
    () => signOutReference,
  );
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await failure(response);
  return response.status === 204 ? (undefined as T) : response.json();
}

export const getMe = () => request<Me>("/api/me");
export const getModels = () => request<Model[]>("/api/models");

export type Loaded<T> = { value?: T; failed: boolean; retry: () => void };

// Load on mount, on retry and when refresh changes, keeping the shown value while it reloads; safe for concurrent page loads
export function useLoaded<T>(load: (() => Promise<T>) | null, refresh = 0): Loaded<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ value?: T; failed: boolean }>({ failed: false });
  useEffect(() => {
    if (!load) return;
    let current = true;
    setState((previous) => ({ value: previous.value, failed: false }));
    load().then(
      (value) => current && setState({ value, failed: false }),
      () => current && setState({ failed: true }),
    );
    return () => {
      current = false;
    };
  }, [load, attempt, refresh]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
}
