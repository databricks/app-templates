export const DISPLAY_ROW_LIMIT = 1000;

export interface ResultPreview {
  // null means the source did not report whether its result was truncated.
  truncated: boolean | null;
  total_row_count?: number;
}

export function summarizeResultPreview(
  receivedRowCount: number,
  truncated: unknown,
  totalRowCount?: unknown,
): ResultPreview {
  const validTotal =
    typeof totalRowCount === 'number' &&
    Number.isSafeInteger(totalRowCount) &&
    totalRowCount >= receivedRowCount &&
    (truncated !== true || totalRowCount > receivedRowCount);
  // Only a positively complete source result lets us use its length as an exact total.
  const total = validTotal ? totalRowCount : truncated === false ? receivedRowCount : undefined;
  const hasMoreRows =
    truncated === true || receivedRowCount > DISPLAY_ROW_LIMIT || (total !== undefined && total > receivedRowCount);
  return {
    truncated: hasMoreRows ? true : truncated === false || total !== undefined ? false : null,
    ...(total === undefined ? {} : { total_row_count: total }),
  };
}
