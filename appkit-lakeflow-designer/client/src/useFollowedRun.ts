import { useEffect, useRef, useState } from 'react';

import type { ActiveRun } from './lastRun';
import type { ConsumerRunPhase } from './landingPlan';
import { FOLLOWED_RUN_NO_OUTCOME_REASON, shouldFollowActiveRun, shouldRetainSettledFollowedRun } from './landingPlan';
import type { RunOutcome, RunSnapshot } from './payload';
import { runStatusRoute } from './routes';
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
      // Nothing eligible to follow. Keep a result we followed THIS run to completion so it stays on
      // screen; otherwise the followed run is gone (or following is disabled), so drop stale
      // following/active/snapshot state instead of leaving the old banner or result up.
      // Keep the terminal snapshot until another run takes its place or the page is reloaded.
      const keepSettled = shouldRetainSettledFollowedRun(activeRunId, settledRunId.current, consumerRunPhase);
      if (!keepSettled) {
        setState((prev) => (prev === IDLE ? prev : IDLE));
      }
      return undefined;
    }

    let cancelled = false;

    setState((prev) =>
      prev.following && prev.active?.run.jobRunId === activeRunId ? prev : { following: true, settled: false, active },
    );

    const poll = async () => {
      if (cancelled) {
        return;
      }
      try {
        const response = await fetch(runStatusRoute(activeRunId));
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          // A 4xx is permanent (the run is gone or is not this app's), so settle instead of polling
          // it forever; only the transient failures below are retried.
          if (response.status >= 400 && response.status < 500) {
            settledRunId.current = activeRunId;
            setState((prev) => ({
              ...prev,
              following: true,
              settled: true,
              outcome: { outcome: 'noPayload', reason: FOLLOWED_RUN_NO_OUTCOME_REASON },
              finishedAt: Date.now(),
            }));
            return;
          }
          throw new Error(`Status check failed with HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as RunSnapshot;
        if (cancelled) {
          return;
        }
        if (snapshot.terminal) {
          settledRunId.current = activeRunId;
          setState((prev) => ({
            ...prev,
            following: true,
            settled: true,
            snapshot,

            outcome: snapshot.result ?? { outcome: 'noPayload', reason: FOLLOWED_RUN_NO_OUTCOME_REASON },
            finishedAt: Date.now(),
          }));
          return;
        }
        setState((prev) => ({ ...prev, snapshot }));
        pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch {

        if (cancelled) {
          return;
        }
        pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);

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
