import { Badge } from '@databricks/appkit-ui/react';
import type { OkPayload } from './payload';

const formatCount = (n: number) => n.toLocaleString();

export interface ResultFooterProps {
  payload: OkPayload;
  matchingRowCount?: number;
}

export function ResultFooter({ payload, matchingRowCount }: ResultFooterProps) {
  const { rows, truncated, total_row_count, metrics } = payload;
  const rowType = truncated === true ? 'preview rows' : truncated === false ? 'rows' : 'returned rows';
  const rowCount = formatCount(matchingRowCount ?? rows.length);
  const rowCountLabel = truncated === true && total_row_count !== undefined
    ? `Showing ${rowCount} of ${formatCount(total_row_count)} rows${matchingRowCount === undefined ? '' : ' (filtered preview)'}`
    : `${rowCount} ${matchingRowCount === undefined ? '' : 'matching '}${rowType}`;

  return (
    <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs">
      <span aria-live="polite" className="text-muted-foreground tabular-nums">
        {rowCountLabel}
        {truncated === true && total_row_count === undefined ? (
          <>
            {' · '}
            <Badge variant="secondary" className="font-normal">Truncated</Badge>
          </>
        ) : null}
      </span>

      {metrics?.collect_ms != null || metrics?.total_ms != null ? (
        <span className="text-muted-foreground ml-auto flex items-center gap-3">
          {metrics?.collect_ms != null ? <span className="tabular-nums">collect {metrics.collect_ms} ms</span> : null}
          {metrics?.total_ms != null ? <span className="tabular-nums">notebook {metrics.total_ms} ms</span> : null}
        </span>
      ) : null}
    </div>
  );
}
