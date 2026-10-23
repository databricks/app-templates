export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export const positiveInt = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

// Run and job IDs are int64: keep them as decimal strings, since Number corrupts values past 2^53-1.
export const idString = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return undefined;
  }
  const text = String(value);
  return /^[1-9][0-9]*$/.test(text) ? text : undefined;
};

export const stringValues = (value: unknown): Record<string, string> | undefined =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : undefined;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
