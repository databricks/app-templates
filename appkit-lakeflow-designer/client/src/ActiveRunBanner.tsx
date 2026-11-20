import { Badge } from '@databricks/appkit-ui/react';

import type { AppParameter, ActiveRun } from '../../server/plugins/designer/client';

import { ACTIVE_RUN_ATTRIBUTION, activeRunStageLabel } from './landingPlan';
import { RunParameterList } from './LastRunLabel';

// Runs restored after a reload are polled separately from a newly submitted run.
export function ActiveRunBanner({ active, declared }: { active: ActiveRun; declared: AppParameter[] }) {
  const { run, parameters, parameterDisplayValues, lifeCycleState } = active;
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
      </div>

      <p className="text-muted-foreground mt-2 text-xs">{ACTIVE_RUN_ATTRIBUTION}</p>

      <RunParameterList parameters={parameters} parameterDisplayValues={parameterDisplayValues} declared={declared} />
    </div>
  );
}
