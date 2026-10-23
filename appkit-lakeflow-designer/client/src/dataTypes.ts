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
  if (
    t === 'tinyint' ||
    t === 'smallint' ||
    t === 'int' ||
    t === 'integer' ||
    t === 'bigint' ||
    t === 'long' ||
    t === 'short' ||
    t === 'byte'
  ) {
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
  const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : '';
  return { text, title: text };
}
