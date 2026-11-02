// Format token counts: 950, 48.2k, 912.5M

const UNITS = [
  { size: 1_000, suffix: "k" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000_000_000, suffix: "T" },
] as const;

const tenths = (value: number) => Math.round(value * 10) / 10;

// Format to one decimal in the smallest unit < 1000 (999_950 → 1M, not 1000k).
export function formatTokenCount(tokens: number): string {
  if (!(tokens >= 1_000)) return `${tokens}`;
  let label = "";
  for (const { size, suffix } of UNITS) {
    const value = tenths(tokens / size);
    label = `${value}${suffix}`;
    if (value < 1_000) break;
  }
  return label;
}
