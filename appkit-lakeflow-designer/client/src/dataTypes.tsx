
export type TypeCategory =
  | 'string'
  | 'integer'
  | 'float'
  | 'decimal'
  | 'binary'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'nested'
  | 'geo'
  | 'interval'
  | 'unknown';

export function categorize(sparkType: string): TypeCategory {
  const t = sparkType.trim().toLowerCase();

  if (t.startsWith('struct') || t.startsWith('array') || t.startsWith('map')) return 'nested';
  if (t === 'variant' || t === 'json' || t === 'jsonb') return 'nested';
  if (t.startsWith('decimal') || t.startsWith('numeric')) return 'decimal';
  if (t.startsWith('interval')) return 'interval';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t === 'date') return 'date';
  if (t.startsWith('timestamp') || t === 'time' || t === 'datetime') return 'timestamp';
  if (t === 'binary' || t === 'bytea') return 'binary';
  if (t === 'float' || t === 'double' || t === 'real') return 'float';
  if (t === 'tinyint' || t === 'smallint' || t === 'int' || t === 'integer' || t === 'bigint' || t === 'long' || t === 'short' || t === 'byte') {
    return 'integer';
  }
  if (t.startsWith('varchar') || t.startsWith('char') || t === 'string' || t === 'text' || t === 'uuid') {
    return 'string';
  }
  if (t === 'geometry' || t === 'geography' || t === 'point' || t === 'polygon') return 'geo';
  return 'unknown';
}

export function isNumericCategory(category: TypeCategory): boolean {
  return category === 'integer' || category === 'float' || category === 'decimal';
}

const GLYPHS: Record<TypeCategory, string> = {
  string: 'Aa',
  integer: '12',
  float: '1.2',
  decimal: '0.0',
  binary: '01',
  boolean: '✓',
  timestamp: '',
  date: '',
  nested: '{}',
  geo: '◍',
  interval: '⧗',
  unknown: '?',
};

const CalendarGlyph = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.1">
    <rect x="1.75" y="2.75" width="10.5" height="9.5" rx="1.25" />
    <path d="M1.75 5.75h10.5M4.5 1.5v2M9.5 1.5v2" />
  </svg>
);

const ClockGlyph = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.1">
    <circle cx="7" cy="7.5" r="4.75" />
    <path d="M7 4.75V7.5l2 1.5" strokeLinecap="round" />
  </svg>
);

export function TypeGlyph({ category }: { category: TypeCategory }) {
  if (category === 'date') return <CalendarGlyph />;
  if (category === 'timestamp') return <ClockGlyph />;
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center font-mono text-[10px] leading-none tracking-tighter">
      {GLYPHS[category]}
    </span>
  );
}

export type FormattedCell = {

  text: string | null;

  title?: string;
};

export function formatCell(value: unknown, category: TypeCategory): FormattedCell {
  if (value === null || value === undefined) return { text: null };

  if (category === 'nested' || typeof value === 'object') {
    const json = JSON.stringify(value);
    return { text: json, title: json };
  }

  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };

  // Jobs keeps bigint, decimal, and timestamp values as strings to avoid precision loss.
  const text = String(value);
  return { text, title: text };
}
