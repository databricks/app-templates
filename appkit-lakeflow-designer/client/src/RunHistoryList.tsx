import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';

import { relative } from './relativeTime';
import type { RunHistoryState } from './runHistory';
import type { RunHistoryEntry } from '../../server/plugins/designer/client';
import { historyEntriesWithDisplayedRun } from './runHistory';

function OutcomeBadge({ resultState }: { resultState?: string }) {
  if (resultState === undefined) {
    return (
      <Badge variant="outline" className="shrink-0 font-normal">
        Outcome not reported
      </Badge>
    );
  }
  if (resultState === 'SUCCESS') {
    return (
      <Badge variant="secondary" className="shrink-0 font-normal">
        Succeeded
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="shrink-0 font-normal">
      {sentenceCase(resultState)}
    </Badge>
  );
}

function sentenceCase(resultState: string): string {
  const words = resultState.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function runLabel(entry: RunHistoryEntry): string {
  if (entry.endTime === undefined) {
    return `Run ${entry.jobRunId}, finished time unavailable`;
  }
  return `Run ${entry.jobRunId} · ${new Date(entry.endTime).toLocaleString()} · ${relative(entry.endTime, Date.now())}`;
}

function HistoryStatus({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="text-muted-foreground max-w-80 text-right text-xs">
      {children}
    </p>
  );
}

export function RunHistorySelect({
  state,
  displayedRun,
  onSelect,
  onLoadMore,
  loadingMore = false,
  loadMoreError,
}: {
  state: RunHistoryState;
  displayedRun?: RunHistoryEntry;
  onSelect: (entry: RunHistoryEntry) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  loadMoreError?: string;
}) {
  if (state.status === 'loading') {
    return <HistoryStatus>Loading run history…</HistoryStatus>;
  }

  if (state.status === 'noJob') {
    return <HistoryStatus>History is unavailable until this app is connected to a job.</HistoryStatus>;
  }

  if (state.status === 'unavailable') {
    return <HistoryStatus>The run history could not be loaded ({state.reason}).</HistoryStatus>;
  }

  const options = historyEntriesWithDisplayedRun(state.runs, displayedRun);
  if (options.length === 0 && !state.hasMore) {
    return <HistoryStatus>You have no completed runs yet.</HistoryStatus>;
  }

  return (
    <div className="grid max-w-full justify-items-end gap-1">
      {options.length === 0 ? (
        <HistoryStatus>No runs found in this page.</HistoryStatus>
      ) : (
        <Select
          value={displayedRun === undefined ? undefined : String(displayedRun.jobRunId)}
          onValueChange={(value) => {
            const entry = options.find((option) => String(option.jobRunId) === value);
            if (entry !== undefined) {
              onSelect(entry);
            }
          }}
        >
          <SelectTrigger aria-label="Run history" className="w-80 max-w-full">
            <SelectValue placeholder="Select a run" />
          </SelectTrigger>
          <SelectContent className="max-h-80 overflow-y-auto">
            {options.map((entry) => (
              <SelectItem key={entry.jobRunId} value={String(entry.jobRunId)} textValue={runLabel(entry)}>
                <span className="flex min-w-0 items-center gap-2">
                  <OutcomeBadge resultState={entry.resultState} />
                  <span className="text-muted-foreground truncate text-xs">{runLabel(entry)}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {state.hasMore ? (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore || !onLoadMore}>
          {loadingMore ? 'Loading older runs…' : 'Load older runs'}
        </Button>
      ) : null}
      {loadMoreError && (
        <p role="alert" className="text-destructive max-w-80 text-right text-xs">
          {loadMoreError}
        </p>
      )}
    </div>
  );
}
