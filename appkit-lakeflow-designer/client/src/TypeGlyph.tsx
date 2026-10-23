import type { TypeCategory } from './dataTypes';

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
