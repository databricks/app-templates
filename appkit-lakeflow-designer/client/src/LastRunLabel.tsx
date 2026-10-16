import { Badge } from '@databricks/appkit-ui/react';

import type { AppParameter } from '../../shared/appManifest';
import type { LastRunSummary } from './lastRun';
import { labelFor } from './parameterLabels';
import { UPLOAD_REFERENCE } from '../../shared/storageConfig';
import { uploadDownloadRoute } from './routes';

export type LastRunVariant = 'last' | 'superseded' | 'justFinished' | 'historical';

const BADGE_LABELS: Record<LastRunVariant, string> = {
  last: 'Last run',
  superseded: 'Previous run',
  justFinished: 'Just finished',
  historical: 'Selected run',
};

const CONTAINER_CLASSES: Record<LastRunVariant, string> = {
  last: 'bg-muted/40 border-l-transparent',
  superseded: 'bg-muted/25 border-l-transparent',
  justFinished: 'bg-muted/40 border-l-transparent',
  historical: 'bg-muted/40 border-l-transparent',
};

export const relative = (endTime: number, now: number): string => {
  const seconds = Math.round((now - endTime) / 1000);
  if (seconds < 0) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export function RunParameterList({
  intro,
  parameters,
  parameterDisplayValues,
  declared,
  linkUploads = false,
}: {
  intro: string;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
  declared: AppParameter[];
  linkUploads?: boolean;
}) {
  if (parameters === undefined) {
    return <p className="text-muted-foreground mt-2 text-xs">The parameters for this run were not recorded.</p>;
  }
  const entries = Object.entries(parameters);
  if (entries.length === 0) {
    return <p className="text-muted-foreground mt-2 text-xs">This run took no parameters.</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">{intro}</span>
      {entries.map(([name, value]) => {
        const displayValue = parameterDisplayValues?.[name] ?? value;
        const downloadable =
          linkUploads &&
          parameterDisplayValues?.[name] !== undefined &&
          UPLOAD_REFERENCE.test(value) &&
          declared.some((parameter) => parameter.name === name && parameter.type === 'file');
        return (
          <span key={name} className="text-muted-foreground">
            <span>{labelFor(name, declared)}</span>
            <span className="text-foreground ml-1 font-mono">
              {downloadable ? (
                <a
                  href={uploadDownloadRoute(name, value)}
                  aria-label={`Download ${displayValue}`}
                  title="Download uploaded file"
                  className="underline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {displayValue}
                </a>
              ) : displayValue === '' ? '(blank)' : displayValue}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function LastRunLabel({
  run,
  parameters,
  parameterDisplayValues,
  declared,
  variant = 'last',
  finishedAt,
  newerRunDidNotSucceed = false,
}: {
  run: LastRunSummary;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
  declared: AppParameter[];
  variant?: LastRunVariant;
  finishedAt?: number;
  newerRunDidNotSucceed?: boolean;
}) {
  const finished = run.endTime ?? finishedAt;

  return (
    <div className={`border-border border-t border-l-4 px-6 py-3 ${CONTAINER_CLASSES[variant]}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Badge variant="secondary" className="font-normal">
          {BADGE_LABELS[variant]}
        </Badge>
        <span className="text-muted-foreground">
          {finished === undefined
            ? 'Finished at an unrecorded time.'
            : `Finished ${relative(finished, Date.now())}, ${new Date(finished).toLocaleString()}.`}
        </span>
        {run.runPageUrl ? (
          <a
            className="text-muted-foreground underline underline-offset-2"
            href={run.runPageUrl}
            target="_blank"
            rel="noreferrer"
          >
            View run
          </a>
        ) : null}
      </div>

      {variant === 'last' && newerRunDidNotSucceed ? (
        <p className="text-muted-foreground mt-1 text-xs">
          A newer run did not succeed. Select it from History to see details.
        </p>
      ) : null}

      <RunParameterList
        intro="Computed with"
        parameters={parameters}
        parameterDisplayValues={parameterDisplayValues}
        declared={declared}
        linkUploads
      />
    </div>
  );
}
