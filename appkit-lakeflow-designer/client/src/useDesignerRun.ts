import { useCallback, useEffect, useRef, useState } from 'react';

import {
  UPLOAD_UNAVAILABLE,
  errorMessage,
  idString,
  isRecord,
  parseRunSnapshot,
  type RunSnapshot,
  RUN_ROUTE,
  runStatusRoute,
} from '../../server/plugins/designer/client';
import { UploadUnavailableError } from './fileUpload';

export const POLL_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 250;

export type RunPhase = 'idle' | 'running' | 'settled';

export type RunState = {
  phase: RunPhase;
  snapshot?: RunSnapshot;
  startedAt?: number;
  elapsedMs: number;
  // The parameters this run was launched with, so a finished run can be labelled with the
  // values it actually used rather than whatever the form holds now.
  params?: Record<string, string>;
  requestError?: string;
  trackingError?: string;
  cancelError?: string;
  cancelling: boolean;
};

export function useDesignerRun(onUploadUnavailable?: () => void) {
  const [state, setState] = useState<RunState>({ phase: 'idle', elapsedMs: 0, cancelling: false });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tickTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const runGeneration = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    if (tickTimer.current !== undefined) clearInterval(tickTimer.current);
    pollTimer.current = undefined;
    tickTimer.current = undefined;
  }, []);

  useEffect(
    () => () => {
      runGeneration.current += 1;
      clearTimers();
    },
    [clearTimers]
  );

  const start = useCallback(
    async (params: Record<string, string>) => {
      clearTimers();
      const generation = runGeneration.current + 1;
      runGeneration.current = generation;

      const startedAt = Date.now();
      setState({ phase: 'running', startedAt, elapsedMs: 0, cancelling: false, params });

      tickTimer.current = setInterval(() => {
        setState((prev) => (prev.phase === 'running' ? { ...prev, elapsedMs: Date.now() - startedAt } : prev));
      }, TICK_INTERVAL_MS);

      const settle = (outcome: Pick<RunState, 'snapshot' | 'requestError'>) => {
        clearTimers();
        setState({
          phase: 'settled',
          startedAt,
          elapsedMs: Date.now() - startedAt,
          cancelling: false,
          params,
          ...outcome,
        });
      };

      let jobRunId: string;
      try {
        const response = await fetch(RUN_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params }),
        });
        if (!response.ok) throw await readRunError(response);
        const body: unknown = await response.json();
        const acceptedRunId = isRecord(body) ? idString(body.jobRunId) : undefined;
        if (acceptedRunId === undefined) {
          throw new Error('The server did not return a valid run ID. Check run history before trying again.');
        }
        jobRunId = acceptedRunId;
      } catch (err) {
        if (runGeneration.current !== generation) return;
        settle({ requestError: errorMessage(err) });
        if (err instanceof UploadUnavailableError) onUploadUnavailable?.();
        return;
      }

      if (runGeneration.current !== generation) return;
      let consecutivePollFailures = 0;
      const poll = async () => {
        if (runGeneration.current !== generation) return;
        try {
          const response = await fetch(runStatusRoute(jobRunId));
          if (!response.ok) throw new Error(`Status check failed with HTTP ${response.status}`);
          const snapshot = parseRunSnapshot(await response.json());
          if (snapshot?.jobRunId !== jobRunId) throw new Error('The server returned an unreadable run status.');
          if (runGeneration.current !== generation) return;
          if (snapshot.terminal) {
            settle({ snapshot });
            return;
          }
          consecutivePollFailures = 0;
          setState((prev) => ({ ...prev, snapshot, trackingError: undefined }));
          pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        } catch (err) {
          if (runGeneration.current !== generation) return;
          // A lost status response does not end the accepted Job or make another submission safe.
          setState((prev) => ({ ...prev, trackingError: errorMessage(err) }));
          const delay = Math.min(30_000, POLL_INTERVAL_MS * 2 ** Math.min(consecutivePollFailures++, 4));
          pollTimer.current = setTimeout(() => void poll(), delay);
        }
      };

      setState((prev) => ({ ...prev, snapshot: { jobRunId, terminal: false, lifeCycleState: 'PENDING' } }));
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    },
    [clearTimers, onUploadUnavailable]
  );

  const cancel = useCallback(async () => {
    const jobRunId = state.snapshot?.jobRunId;
    if (jobRunId == null) return;
    const generation = runGeneration.current;
    setState((prev) => ({ ...prev, cancelling: true, cancelError: undefined }));
    try {
      const response = await fetch(runStatusRoute(jobRunId), { method: 'DELETE' });
      if (!response.ok) throw await readRunError(response);
    } catch (error) {
      if (runGeneration.current !== generation) return;
      setState((prev) =>
        prev.phase === 'running' ? { ...prev, cancelling: false, cancelError: errorMessage(error) } : prev
      );
    }
  }, [state.snapshot?.jobRunId]);

  const reset = useCallback(() => {
    setState((prev) => (prev.phase === 'running' ? prev : { phase: 'idle', elapsedMs: 0, cancelling: false }));
  }, []);

  return { state, start, cancel, reset };
}

async function readRunError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isRecord(body) && typeof body.error === 'string' && body.error !== '') {
    return body.code === UPLOAD_UNAVAILABLE ? new UploadUnavailableError(body.error) : new Error(body.error);
  }
  return new Error(`Request failed with HTTP ${response.status}`);
}
