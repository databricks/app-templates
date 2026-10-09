import { Badge } from '@databricks/appkit-ui/react';

import type { AppParameter } from '../../shared/appManifest';
import type { ActiveRun } from './lastRun';
import { ACTIVE_RUN_ATTRIBUTION, activeRunStageLabel } from './landingPlan';
import { labelFor } from './parameterLabels';

// A landing run may belong to another consumer, so never imply ownership or offer cancellation.
export function ActiveRunBanner({ active, declared }: { active: ActiveRun; declared: AppParameter[] }) {
  const { run, parameters, parameterDisplayValues, lifeCycleState } = active;
  const entries = parameters === undefined ? [] : Object.entries(parameters);
  const startedAt = run.startTime;

  return (
    <div
      className="border-border bg-muted/40 border-t border-b border-l-4 px-6 py-4"
      style={{ borderLeftColor: 'var(--chart-1)' }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span
          className="inline-block size-2 shrink-0 animate-pulse rounded-full"
          style={{ backgroundColor: 'var(--chart-1)' }}
          aria-hidden="true"
        />
        <Badge className="border-transparent font-normal text-white" style={{ backgroundColor: 'var(--chart-1)' }}>
          Run in progress
        </Badge>
        <span className="font-semibold" style={{ color: 'var(--chart-1)' }}>
          {activeRunStageLabel(lifeCycleState)}
        </span>
        {startedAt === undefined ? null : (
          <span className="text-muted-foreground text-xs tabular-nums">
            started {new Date(startedAt).toLocaleTimeString(undefined, { hour12: false })}
          </span>
        )}
        {run.runPageUrl ? (
          <a
            className="text-muted-foreground text-xs underline underline-offset-2"
            href={run.runPageUrl}
            target="_blank"
            rel="noreferrer"
          >
            View run
          </a>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-2 text-xs">{ACTIVE_RUN_ATTRIBUTION}</p>

      {parameters === undefined ? (

        <p className="text-muted-foreground mt-2 text-xs">The parameters for this run were not recorded.</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">This run took no parameters.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Running with</span>
          {entries.map(([name, value]) => (
            <span key={name} className="text-muted-foreground">
              <span>{labelFor(name, declared)}</span>
              <span className="text-foreground ml-1 font-mono">
                {(parameterDisplayValues?.[name] ?? value) === '' ? '(blank)' : (parameterDisplayValues?.[name] ?? value)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
