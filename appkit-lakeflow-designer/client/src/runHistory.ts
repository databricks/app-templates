import {
  errorMessage,
  isRecord,
  nonEmptyString,
  positiveInt,
  parseRunHistoryEntry,
  type RunHistoryEntry,
  type RunOutcome,
  type RunSnapshot,
  parseRunSnapshot,
  runHistoryRoute,
  runStatusRoute,
} from '../../server/plugins/designer/client';

export type RunHistoryState =
  | { status: 'loading' }
  | { status: 'noJob' }
  | { status: 'unavailable'; reason: string }
  | { status: 'found'; runs: RunHistoryEntry[]; hasMore: boolean; window: number; nextPageToken?: string };

export const RUN_HISTORY_FIRST_WINDOW = 100;

const SUCCESSFUL_RESULT_STATES = new Set(['SUCCESS', 'SUCCESS_WITH_FAILURES']);

const TERMINAL_UNSUCCESSFUL_RESULT_STATES = new Set([
  'FAILED',
  'TIMEDOUT',
  'CANCELED',
  'MAXIMUM_CONCURRENT_RUNS_REACHED',
  'UPSTREAM_CANCELED',
  'UPSTREAM_FAILED',
  'EXCLUDED',
  'EVICTED',
  'UPSTREAM_EVICTED',
  'DISABLED',
]);

export function isSuccessfulResultState(resultState: string | undefined): boolean {
  return resultState !== undefined && SUCCESSFUL_RESULT_STATES.has(resultState);
}

export function hasNewerUnsuccessfulRun(runs: RunHistoryEntry[], lastSuccessfulEndTime: number | undefined): boolean {
  if (lastSuccessfulEndTime === undefined) {
    return false;
  }
  return runs.some(
    (run) =>
      run.endTime !== undefined &&
      run.endTime > lastSuccessfulEndTime &&
      run.resultState !== undefined &&
      TERMINAL_UNSUCCESSFUL_RESULT_STATES.has(run.resultState)
  );
}

export function historyEntriesWithDisplayedRun(
  runs: RunHistoryEntry[],
  displayedRun: RunHistoryEntry | undefined
): RunHistoryEntry[] {
  if (displayedRun === undefined) {
    return runs;
  }
  const matchingIndex = runs.findIndex((run) => run.jobRunId === displayedRun.jobRunId);
  if (matchingIndex >= 0) {
    return runs.map((run, index) => (index === matchingIndex ? { ...displayedRun, ...run } : run));
  }
  const displayedTime = displayedRun.startTime ?? displayedRun.endTime;
  if (displayedTime === undefined) {
    return [displayedRun, ...runs];
  }
  const insertionIndex = runs.findIndex((run) => displayedTime > (run.startTime ?? run.endTime ?? 0));
  if (insertionIndex < 0) {
    return [...runs, displayedRun];
  }
  return [...runs.slice(0, insertionIndex), displayedRun, ...runs.slice(insertionIndex)];
}

export async function fetchRunHistory(
  windowSize: number,
  cursor?: string,
  signal?: AbortSignal
): Promise<RunHistoryState> {
  try {
    const response = await fetch(runHistoryRoute(windowSize, cursor), { signal });
    if (!response.ok) {
      return { status: 'unavailable', reason: `the server returned ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { status: 'unavailable', reason: 'the server returned an unreadable response' };
    }
    if (body.status === 'noJob') {
      return { status: 'noJob' };
    }
    if (body.status === 'unavailable') {
      return { status: 'unavailable', reason: nonEmptyString(body.reason) ?? 'unknown reason' };
    }
    if (body.status !== 'found' || !Array.isArray(body.runs)) {
      return { status: 'unavailable', reason: 'the server returned an unreadable run history' };
    }
    const runs = body.runs.map(parseRunHistoryEntry).filter((entry): entry is RunHistoryEntry => entry !== undefined);
    return {
      status: 'found',
      runs,
      hasMore: nonEmptyString(body.nextPageToken) !== undefined,
      nextPageToken: nonEmptyString(body.nextPageToken),
      window: positiveInt(body.window) ?? windowSize,
    };
  } catch (error) {
    return { status: 'unavailable', reason: errorMessage(error) };
  }
}

export type SelectedRunState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'found'; outcome: RunOutcome; snapshot: RunSnapshot };

export async function fetchRunResult(jobRunId: string): Promise<SelectedRunState> {
  try {
    const response = await fetch(runStatusRoute(jobRunId));
    if (response.status === 404) {
      return { status: 'unavailable', reason: `Run ${jobRunId} is not a run of this app.` };
    }
    if (!response.ok) {
      return { status: 'unavailable', reason: `the server returned ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { status: 'unavailable', reason: 'the server returned an unreadable response' };
    }
    const snapshot = parseRunSnapshot(body);
    if (snapshot?.result === undefined) {
      return { status: 'unavailable', reason: 'the run reported no readable result' };
    }
    return { status: 'found', outcome: snapshot.result, snapshot };
  } catch (error) {
    return { status: 'unavailable', reason: errorMessage(error) };
  }
}
