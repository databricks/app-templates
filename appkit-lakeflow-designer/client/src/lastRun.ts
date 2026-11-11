import {
  errorMessage,
  isRecord,
  stringValues,
  parseLastRunSummary,
  parseActiveRun,
  type LastRunSummary,
  type ActiveRun,
  type RunOutcome,
  parseRunOutcome,
  LAST_RUN_ROUTE,
} from '../../server/plugins/designer/client';

export type LastRunState =
  | { status: 'loading' }
  | { status: 'noJob' }
  | { status: 'none'; active?: ActiveRun }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'found';
      run: LastRunSummary;
      parameters?: Record<string, string>;
      parameterDisplayValues?: Record<string, string>;
      result: RunOutcome;
      active?: ActiveRun;
    };

export async function fetchLastRun(signal?: AbortSignal): Promise<LastRunState> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  let active: ActiveRun | undefined;
  try {
    for (;;) {
      const response = await fetch(`${LAST_RUN_ROUTE}${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`, {
        signal,
      });
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
      active = parseActiveRun(body.active) ?? active;
      if (body.status === 'searching') {
        if (typeof body.nextPageToken !== 'string' || !body.nextPageToken || seen.has(body.nextPageToken)) {
          return { status: 'unavailable', reason: 'the server could not continue searching run history' };
        }
        cursor = body.nextPageToken;
        seen.add(cursor);
        continue;
      }
      if (body.status === 'none') {
        return { status: 'none', ...(active === undefined ? {} : { active }) };
      }
      if (body.status === 'unavailable') {
        return { status: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : 'unknown reason' };
      }
      const run = parseLastRunSummary(body.run);
      const result = parseRunOutcome(body.result);
      if (body.status !== 'found' || run === undefined || result === undefined) {
        return { status: 'unavailable', reason: 'the server returned an unreadable last run' };
      }
      const parameters = stringValues(body.parameters);
      const parameterDisplayValues = stringValues(body.parameterDisplayValues);
      return {
        status: 'found',
        run,
        ...(parameters === undefined ? {} : { parameters }),
        ...(parameterDisplayValues === undefined ? {} : { parameterDisplayValues }),
        result,
        ...(active === undefined ? {} : { active }),
      };
    }
  } catch (error) {
    return { status: 'unavailable', reason: errorMessage(error) };
  }
}
