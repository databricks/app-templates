import { useEffect, useRef, useState } from 'react';

import {
  type ActiveRun,
  parseRunSnapshot,
  type RunOutcome,
  type RunSnapshot,
  runStatusRoute,
} from '../../server/plugins/designer/client';
import type { ConsumerRunPhase } from './landingPlan';
import { FOLLOWED_RUN_NO_OUTCOME_REASON, shouldFollowActiveRun, shouldRetainSettledFollowedRun } from './landingPlan';

import { POLL_INTERVAL_MS } from './useDesignerRun';

export type FollowedRunState = {
  following: boolean;
  settled: boolean;
  active?: ActiveRun;
  snapshot?: RunSnapshot;
  outcome?: RunOutcome;
  finishedAt?: number;
};

const IDLE: FollowedRunState = { following: false, settled: false };
const NO_OUTCOME: RunOutcome = { outcome: 'noPayload', reason: FOLLOWED_RUN_NO_OUTCOME_REASON };

export function useFollowedRun(active: ActiveRun | undefined, consumerRunPhase: ConsumerRunPhase): FollowedRunState {
  const [state, setState] = useState<FollowedRunState>(IDLE);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settledRunId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const activeRunId = active?.run.jobRunId;
    if (
      activeRunId === undefined ||
      !shouldFollowActiveRun({
        activeRunId,
        consumerRunPhase,
        followedSettled: settledRunId.current === activeRunId,
      })
    ) {
      // Keep a run we followed to completion on screen until another run replaces it or the page
      // reloads; otherwise drop the stale banner or result.
      if (!shouldRetainSettledFollowedRun(activeRunId, settledRunId.current, consumerRunPhase)) {
        setState(IDLE);
      }
      return undefined;
    }

    let cancelled = false;

    setState((prev) =>
      prev.following && prev.active?.run.jobRunId === activeRunId ? prev : { following: true, settled: false, active }
    );

    const settle = (result: Pick<FollowedRunState, 'snapshot' | 'outcome'>) => {
      settledRunId.current = activeRunId;
      setState((prev) => ({ ...prev, following: true, settled: true, ...result, finishedAt: Date.now() }));
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(runStatusRoute(activeRunId));
        if (cancelled) return;
        if (!response.ok) {
          // A 4xx is permanent (the run is gone or is not this app's), so settle instead of polling
          // it forever; only the transient failures below are retried.
          if (response.status >= 400 && response.status < 500) {
            settle({ outcome: NO_OUTCOME });
            return;
          }
          throw new Error(`Status check failed with HTTP ${response.status}`);
        }
        const snapshot = parseRunSnapshot(await response.json());
        if (snapshot?.jobRunId !== activeRunId) throw new Error('The server returned an unreadable run status.');
        if (cancelled) return;
        if (snapshot.terminal) {
          settle({ snapshot, outcome: snapshot.result ?? NO_OUTCOME });
          return;
        }
        setState((prev) => ({ ...prev, snapshot }));
        schedulePoll();
      } catch {
        if (!cancelled) schedulePoll();
      }
    };

    const schedulePoll = () => {
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    schedulePoll();

    return () => {
      cancelled = true;
      if (pollTimer.current !== undefined) {
        clearTimeout(pollTimer.current);
        pollTimer.current = undefined;
      }
    };
  }, [active, consumerRunPhase]);

  return state;
}
