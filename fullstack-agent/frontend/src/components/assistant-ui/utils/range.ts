// Normalize numeric props: negative or NaN values from caller state can break CSS or array slicing.

// Constrain value to min…max; NaN maps to min. Max wins if bounds invert (empty collection edge case).
export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function take<T>(items: readonly T[], count: number) {
  return items.slice(0, Math.floor(clamp(count, 0, items.length)));
}
