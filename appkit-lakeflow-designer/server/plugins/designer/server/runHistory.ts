import { isRecord, nonEmptyString } from '../shared/values';

export interface VisibleRunPage {
  runs: Record<string, unknown>[];
  nextPageToken?: string;
}

// Bound each HTTP request, but preserve the Jobs cursor when other viewers fill the scan.
export async function scanVisibleRuns({
  pageToken,
  readPage,
  accessible,
  isComplete,
}: {
  pageToken?: string;
  readPage: (pageToken?: string) => Promise<unknown>;
  accessible: (run: unknown) => Promise<Record<string, unknown> | undefined>;
  isComplete: (runs: Record<string, unknown>[]) => boolean;
}): Promise<VisibleRunPage> {
  const runs: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  if (pageToken) seen.add(pageToken);
  for (let page = 0; page < 8; page += 1) {
    const response = await readPage(pageToken);
    if (!isRecord(response) || (response.runs !== undefined && !Array.isArray(response.runs))) {
      throw new Error('The Job returned an unreadable run-history page.');
    }
    for (const run of Array.isArray(response.runs) ? response.runs : []) {
      const visible = await accessible(run);
      if (visible) runs.push(visible);
    }
    pageToken = nonEmptyString(response.next_page_token);
    if (!pageToken) return { runs };
    if (seen.has(pageToken)) throw new Error('The Job returned a repeated run-history cursor.');
    seen.add(pageToken);
    if (isComplete(runs)) break;
  }
  return { runs, nextPageToken: pageToken };
}
