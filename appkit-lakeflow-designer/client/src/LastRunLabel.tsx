import {
  type AppParameter,
  UPLOAD_REFERENCE,
  type LastRunSummary,
  uploadDownloadRoute,
} from '../../server/plugins/designer/client';
import { relative } from './relativeTime';
import { useNow } from './useNow';
import { Badge } from '@databricks/appkit-ui/react';
import type { ReactNode } from 'react';
import { createContext, Fragment, useContext, useMemo, useState } from 'react';

import { labelFor } from './parameterLabels';

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

const RunParametersDisclosureContext = createContext<
  | {
      expanded: boolean;
      setExpanded: (expanded: boolean) => void;
    }
  | undefined
>(undefined);

export function RunParametersDisclosureProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const value = useMemo(() => ({ expanded, setExpanded }), [expanded]);
  return <RunParametersDisclosureContext.Provider value={value}>{children}</RunParametersDisclosureContext.Provider>;
}

export function RunParameterList({
  parameters,
  parameterDisplayValues,
  declared,
  linkUploads = false,
}: {
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
  declared: AppParameter[];
  linkUploads?: boolean;
}) {
  const disclosure = useContext(RunParametersDisclosureContext);
  if (parameters === undefined) {
    return <p className="text-muted-foreground mt-2 text-xs">The parameters for this run were not recorded.</p>;
  }
  const entries = Object.entries(parameters);
  if (entries.length === 0) {
    return <p className="text-muted-foreground mt-2 text-xs">This run took no parameters.</p>;
  }
  return (
    <details
      className="mt-2 text-xs"
      open={disclosure?.expanded}
      onToggle={(event) => disclosure?.setExpanded(event.currentTarget.open)}
    >
      <summary className="text-muted-foreground cursor-pointer select-none">Parameters ({entries.length})</summary>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-x-4 gap-y-2">
        {entries.map(([name, value]) => {
          const displayValue = parameterDisplayValues?.[name] ?? value;
          const downloadable =
            linkUploads &&
            parameterDisplayValues?.[name] !== undefined &&
            UPLOAD_REFERENCE.test(value) &&
            declared.some((parameter) => parameter.name === name && parameter.type === 'file');
          return (
            <Fragment key={name}>
              <dt className="text-muted-foreground break-words">{labelFor(name, declared)}</dt>
              <dd className="text-foreground min-w-0 break-words font-mono">
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
                ) : displayValue === '' ? (
                  '(blank)'
                ) : (
                  displayValue
                )}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </details>
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
  const now = useNow();

  return (
    <div className={`border-border border-t border-l-4 px-6 py-3 ${CONTAINER_CLASSES[variant]}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Badge variant="secondary" className="font-normal">
          {BADGE_LABELS[variant]}
        </Badge>
        <span className="text-muted-foreground">
          {finished === undefined
            ? 'Finished at an unrecorded time.'
            : `Finished ${relative(finished, now)}, ${new Date(finished).toLocaleString()}.`}
        </span>
      </div>

      {variant === 'last' && newerRunDidNotSucceed ? (
        <p className="text-muted-foreground mt-1 text-xs">
          A newer run did not succeed. Select it from History to see details.
        </p>
      ) : null}

      <RunParameterList
        parameters={parameters}
        parameterDisplayValues={parameterDisplayValues}
        declared={declared}
        linkUploads
      />
    </div>
  );
}
