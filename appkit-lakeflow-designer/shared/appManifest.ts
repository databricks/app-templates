import { z } from 'zod/mini';
import { parseAppStorage } from './storageConfig';
import { isFileFormats } from './fileFormats';
import { hasInvalidFileOutputDeclaration, parseFileOutput } from './fileOutputs';
import { isValidMultiselectConfig } from './multiselect';

const nonEmptyString = z.string().check(z.minLength(1));
const stringOrEmpty = z.catch(z.string(), '');
const record = z.record(z.string(), z.unknown());

const chartSpecSchema = z.looseObject({ widgetType: nonEmptyString });
const provenanceSchema = z.looseObject({ publishedAt: z.number().check(z.positive()) });
const targetSchema = z.object({ nodeId: nonEmptyString, label: stringOrEmpty });

const parameterSchema = z.pipe(
  z.object({
    name: nonEmptyString.check(z.refine((name) =>
      name !== 'target_node' && name !== 'ld_display_outputs' && name !== 'ld_display_outputs_for' && !name.startsWith('_lb_'),
    )),
    label: z.string(),
    type: z.catch(z.enum(['text', 'number', 'dropdown', 'combobox', 'multiselect', 'file']), 'text'),
    defaultValue: stringOrEmpty,
    choices: z.catch(z.optional(z.array(z.string())), undefined),
    fileFormats: z.unknown(),
    help: z.unknown(),
  }),
  z.transform((entry) => {
    const choices = entry.type === 'combobox' || (entry.choices?.length ?? 0) > 0 ? entry.choices : undefined;
    const type = entry.type === 'dropdown' && choices === undefined ? 'text' : entry.type;
    return {
      name: entry.name,
      label: entry.label,
      type,
      defaultValue: type === 'file' ? '' : entry.defaultValue,
      ...((type === 'dropdown' || type === 'combobox' || type === 'multiselect') && choices !== undefined ? { choices } : {}),
      ...(type === 'file' && isFileFormats(entry.fileFormats) ? { fileFormats: entry.fileFormats } : {}),
      ...(typeof entry.help === 'string' && entry.help !== '' ? { help: entry.help } : {}),
    };
  }),
);

const markdownBlockSchema = z.pipe(
  z.object({
    type: z.literal('markdown'),
    id: z.catch(z.optional(nonEmptyString), undefined),
    text: z.string(),
  }),
  z.transform(({ type, id, text }) => ({ type, ...(id === undefined ? {} : { id }), text })),
);

const outputBlockSchema = z.pipe(
  z.object({
    type: z.literal('output'),
    id: nonEmptyString,
    label: stringOrEmpty,
    nodeId: stringOrEmpty,
    port: stringOrEmpty,
    chartSpec: z.catch(z.optional(chartSpecSchema), undefined),
    fileOutput: z.transform(parseFileOutput),
  }),
  z.transform(({ chartSpec, fileOutput, ...block }) => ({
    ...block,
    ...(chartSpec === undefined ? {} : { chartSpec }),
    ...(fileOutput === undefined ? {} : { fileOutput }),
  })),
);

const blockSchema = z.union([markdownBlockSchema, outputBlockSchema]);

function parseBlocks(raw: unknown): AppManifestBlock[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const block = blockSchema.safeParse(entry).data;
    if (!block) return [];
    if (block.type === 'output') {
      if (seen.has(block.id)) return [];
      seen.add(block.id);
    }
    return [block];
  });
}

// Both the workspace manifest and /config response use this contract. Ordinary malformed display
// entries can be omitted; declarations governing file access must reject the entire manifest.
export const appManifestSchema = z.pipe(
  z.object({
    version: z.literal(6),
    appName: nonEmptyString,
    subtitle: z.unknown(),
    provenance: z.unknown(),
    target: z.unknown(),
    storage: z.unknown(),
    blocks: z.unknown(),
    parameters: z.array(z.unknown()),
  }),
  z.transform((raw, ctx) => {
    const storage = parseAppStorage(raw.storage);
    const blocks = parseBlocks(raw.blocks);
    const entries = raw.parameters.flatMap((entry) => {
      const parsed = record.safeParse(entry).data;
      return parsed ? [parsed] : [];
    });
    if (
      !blocks.some((block) => block.type === 'output') ||
      hasInvalidFileOutputDeclaration(raw.blocks) ||
      (raw.storage !== undefined && !storage) ||
      entries.some((entry) =>
        (entry.type === 'file' && (!storage || (entry.fileFormats !== undefined && !isFileFormats(entry.fileFormats)))) ||
        (entry.type === 'multiselect' && !isValidMultiselectConfig(entry.choices, entry.defaultValue)),
      )
    ) {
      ctx.issues.push({ code: 'custom', input: raw, message: 'Invalid published app configuration' });
      return z.NEVER;
    }
    const provenance = provenanceSchema.safeParse(raw.provenance).data;
    const target = targetSchema.safeParse(raw.target).data;
    return {
      ...(storage === undefined ? {} : { storage }),
      version: raw.version,
      appName: raw.appName,
      ...(typeof raw.subtitle === 'string' && raw.subtitle !== '' ? { subtitle: raw.subtitle } : {}),
      ...(provenance === undefined ? {} : { provenance }),
      ...(target === undefined ? {} : { target }),
      blocks,
      parameters: entries.flatMap((entry) => {
        const parameter = parameterSchema.safeParse(entry).data;
        return parameter ? [parameter] : [];
      }),
    };
  }),
);

export type AppChartSpec = z.output<typeof chartSpecSchema>;
export type AppParameter = z.output<typeof parameterSchema>;
export type AppMarkdownBlock = z.output<typeof markdownBlockSchema>;
export type AppOutputBlock = z.output<typeof outputBlockSchema>;
export type AppManifestBlock = z.output<typeof blockSchema>;
export type AppManifest = z.output<typeof appManifestSchema>;
