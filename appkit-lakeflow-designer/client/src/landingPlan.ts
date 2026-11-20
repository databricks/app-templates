import { idString } from '../../server/plugins/designer/client';

export type ConsumerRunPhase = 'idle' | 'running' | 'settled';

export type LastRunStatus = 'loading' | 'noJob' | 'none' | 'unavailable' | 'found';

export type LandingEmptyReason = 'loading' | 'never' | 'unavailable';

export type LandingSection =
  | { kind: 'activeRun' }
  | { kind: 'followedResult' }
  | { kind: 'lastRun'; superseded: boolean }
  | { kind: 'selectedRun' }
  | { kind: 'followedResultAvailable' }
  | { kind: 'empty'; reason: LandingEmptyReason };

export interface LandingInput {
  lastRun: LastRunStatus;
  following: boolean;
  followedSettled: boolean;
  selectedRun: boolean;
}

export function planLandingArea({ lastRun, following, followedSettled, selectedRun }: LandingInput): LandingSection[] {
  if (following && followedSettled) {
    return selectedRun ? [{ kind: 'followedResultAvailable' }, { kind: 'selectedRun' }] : [{ kind: 'followedResult' }];
  }
  if (following) {
    if (selectedRun) {
      return [{ kind: 'activeRun' }, { kind: 'selectedRun' }];
    }
    return lastRun === 'found'
      ? [{ kind: 'activeRun' }, { kind: 'lastRun', superseded: true }]
      : [{ kind: 'activeRun' }];
  }

  if (selectedRun) {
    return [{ kind: 'selectedRun' }];
  }
  switch (lastRun) {
    case 'found':
      return [{ kind: 'lastRun', superseded: false }];
    case 'loading':
      return [{ kind: 'empty', reason: 'loading' }];
    case 'unavailable':
      return [{ kind: 'empty', reason: 'unavailable' }];
    case 'none':
    case 'noJob':
      return [{ kind: 'empty', reason: 'never' }];
  }
}

export interface FollowInput {
  activeRunId: string | undefined;
  consumerRunPhase: ConsumerRunPhase;
  followedSettled: boolean;
}

export function shouldFollowActiveRun({ activeRunId, consumerRunPhase, followedSettled }: FollowInput): boolean {
  return idString(activeRunId) !== undefined && !followedSettled && consumerRunPhase === 'idle';
}

export function shouldRetainSettledFollowedRun(
  activeRunId: string | undefined,
  settledRunId: string | undefined,
  consumerRunPhase: ConsumerRunPhase
): boolean {
  // /last-run no longer reports this run as active after it terminates.
  return (
    consumerRunPhase === 'idle' &&
    settledRunId !== undefined &&
    (activeRunId === undefined || activeRunId === settledRunId)
  );
}

export function activeRunStageLabel(lifeCycleState: string | undefined): string {
  switch (lifeCycleState) {
    case 'QUEUED':
    case 'PENDING':
      return 'Waiting to start';
    case 'RUNNING':
      return 'Computing';
    case 'TERMINATING':
      return 'Finishing up';
    default:
      return 'In progress';
  }
}

export const ACTIVE_RUN_ATTRIBUTION = 'Your run is in progress. Its result will appear here when it finishes.';

export const FOLLOWED_RESULT_AVAILABLE_OFFER =
  'A run of this app finished while you were looking at an earlier one. Open it to see its outcome; ' +
  'this will replace the run shown below.';

export const FOLLOWED_RUN_NO_OUTCOME_REASON =
  'The run finished but reported no output, so its result could not be read.';
