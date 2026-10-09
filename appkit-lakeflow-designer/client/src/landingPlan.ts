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
  // activeRunId is a run id (int64), carried as a positive decimal string; reject anything else.
  if (activeRunId === undefined || !/^[1-9][0-9]*$/.test(activeRunId)) {
    return false;
  }
  return !followedSettled && consumerRunPhase === 'idle';
}

export function shouldRetainSettledFollowedRun(
  activeRunId: string | undefined,
  settledRunId: string | undefined,
  consumerRunPhase: ConsumerRunPhase,
): boolean {
  // /last-run no longer reports this run as active after it terminates.
  return consumerRunPhase === 'idle' && settledRunId !== undefined &&
    (activeRunId === undefined || activeRunId === settledRunId);
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

export const CONSUMER_RUN_STAGE_LABELS = ['Queued…', 'Running…', 'Fetching results…'] as const;

export const ACTIVE_RUN_ATTRIBUTION =
  'A run of this app is in progress. It may have been started by someone else, and its result will appear here when it finishes.';

export const SUPERSEDED_RUN_ATTRIBUTION =
  'This result is from an earlier run and has been superseded by the run in progress above. It will be replaced when that run finishes.';

export const LAST_RUN_ATTRIBUTION =
  'This is the most recent successful run of this app, not necessarily one you started. Press Run to compute a fresh result with the values above.';

export const SELECTED_RUN_ATTRIBUTION =
  "This is a run you selected from this app's history. It was computed with the values shown below, " +
  'which may differ from the ones in the form above. Press Run to compute a fresh result.';

export const FOLLOWED_RUN_ATTRIBUTION =
  'This run finished while you were watching. It may have been started by someone else, so the values it used are shown below.';

export const FOLLOWED_RESULT_AVAILABLE_OFFER =
  'A run of this app finished while you were looking at an earlier one. Open it to see its outcome; ' +
  'this will replace the run shown below.';

export const FOLLOWED_RUN_NO_OUTCOME_REASON =
  'The run finished but reported no output, so its result could not be read.';
