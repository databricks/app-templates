import { Button } from '@databricks/appkit-ui/react';
import type { RunSnapshot } from './payload';

type Stage = { key: string; label: string; dotClass: string };

const STAGES: Stage[] = [
  { key: 'queued', label: 'Queued…', dotClass: 'bg-yellow-400' },
  { key: 'running', label: 'Running…', dotClass: 'bg-blue-400' },
  { key: 'fetching', label: 'Fetching results…', dotClass: 'bg-green-400' },
];

function stageIndexFor(lifeCycleState: string | undefined): number {
  switch (lifeCycleState) {
    case 'TERMINATING':
    case 'TERMINATED':
      return 2;
    case 'RUNNING':
      return 1;
    default:
      return 0;
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function RunStatus({
  snapshot,
  computingLabel,
  startedAt,
  elapsedMs,
  onCancel,
  cancelling,
}: {
  snapshot: RunSnapshot | undefined;

  computingLabel: string;
  startedAt: number;
  elapsedMs: number;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const activeIndex = stageIndexFor(snapshot?.lifeCycleState);
  const startTime = new Date(startedAt).toLocaleTimeString(undefined, { hour12: false });

  return (
    <div className="border-border border-t p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{STAGES[activeIndex].label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">{formatElapsed(elapsedMs)} elapsed</span>
        </div>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling || snapshot?.terminal}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>

      <div className="mt-4 flex gap-1.5" role="presentation">
        {STAGES.map((stage, index) => (
          <div key={stage.key} className="flex-1">
            <div
              className={[
                'h-1 w-full rounded-full transition-colors',
                index < activeIndex ? stage.dotClass : '',
                index === activeIndex ? `${stage.dotClass} animate-pulse` : '',
                index > activeIndex ? 'bg-muted' : '',
              ].join(' ')}
            />
            <div
              className={index === activeIndex ? 'text-foreground mt-1.5 text-xs' : 'text-muted-foreground mt-1.5 text-xs'}
            >
              {stage.label.replace('…', '')}
            </div>
          </div>
        ))}
      </div>

      <dl className="text-muted-foreground mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt>Computing</dt>
        <dd className="text-foreground">{computingLabel}</dd>
        <dt>Started</dt>
        <dd className="tabular-nums">{startTime}</dd>
        {snapshot?.runPageUrl ? (
          <>
            <dt>Run</dt>
            <dd>
              <a className="underline underline-offset-2" href={snapshot.runPageUrl} target="_blank" rel="noreferrer">
                Open in Jobs
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
