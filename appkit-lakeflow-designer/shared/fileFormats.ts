const FORMAT_EXTENSIONS: Record<string, readonly string[]> = {
  excel: ['.xls', '.xlsx'],
  csv: ['.csv', '.tsv', '.tab', '.txt'],
  json: ['.json', '.jsonl', '.ndjson'],
  parquet: ['.parquet'],
  avro: ['.avro'],
  orc: ['.orc'],
  xml: ['.xml'],
  pdf: ['.pdf'],
};
const COMPRESSION_EXTENSIONS = ['.gz', '.bz2', '.deflate', '.lz4', '.snappy', '.zst', '.zstd'];

export const isFileFormats = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((format) => typeof format === 'string' && format !== '' && format === format.trim().toLowerCase());

function extensionsFor(format: string): readonly string[] | undefined {
  const extensions = Object.hasOwn(FORMAT_EXTENSIONS, format) ? FORMAT_EXTENSIONS[format] : undefined;
  if (!extensions || !['csv', 'json', 'xml'].includes(format)) return extensions;
  return extensions.flatMap((extension) => [extension, ...COMPRESSION_EXTENSIONS.map((suffix) => extension + suffix)]);
}

// Text, binary, inferred and runtime-parameterized formats have no reliable filename restriction.
export function uploadAccept(fileFormats: readonly string[] = []): string | undefined {
  const restrictions = fileFormats.flatMap((format) => {
    const extensions = extensionsFor(format);
    return extensions ? [extensions] : [];
  });
  return (
    restrictions[0]?.filter((extension) => restrictions.every((allowed) => allowed.includes(extension))).join(',') ||
    undefined
  );
}

export function validateFileFormat(filename: string, fileFormats: readonly string[] = []): string | undefined {
  for (const format of fileFormats) {
    const extensions = extensionsFor(format);
    if (extensions && !extensions.some((extension) => filename.toLowerCase().endsWith(extension))) {
      const label = format === 'excel' ? 'Excel' : format.toUpperCase();
      return `This Source expects ${label} (${FORMAT_EXTENSIONS[format].join(', ')}). Choose a matching file.`;
    }
  }
  return undefined;
}
