import { z } from 'zod/mini';

import { isFileFormats } from './fileFormats.ts';
import { hasInvalidFileOutputDeclaration, parseFileOutput } from './fileOutputs.ts';
import { isValidMultiselectConfig } from './multiselect.ts';
import { RUNNER_REVISION_PARAM } from './publishedRunner.ts';
import { parseAppStorage } from './storageConfig.ts';

const nonEmptyString = z.string().check(z.minLength(1));
const stringOrEmpty = z.catch(z.string(), '');
const record = z.record(z.string(), z.unknown());
const optionalBoolean = z.catch(z.optional(z.boolean()), undefined);

const RESERVED_PARAMETERS = new Set(['target_node', 'ld_display_outputs', 'ld_display_outputs_for']);

export function isReservedParameter(name: string): boolean {
  return RESERVED_PARAMETERS.has(name) || name.startsWith('_lb_');
}

const chartSpecSchema = z.looseObject({ widgetType: nonEmptyString });
const provenanceSchema = z.object({
  publishedAt: z.number().check(z.positive()),
  generatorVersion: z.catch(z.optional(z.union([z.string(), z.number()])), undefined),
});
const targetSchema = z.object({ nodeId: nonEmptyString, label: stringOrEmpty });
const runnerSchema = z
  .object({
    revision: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
    parameters: z.record(z.string(), z.string()),
  })
  .check(z.refine((runner) => runner.parameters[RUNNER_REVISION_PARAM] === runner.revision));

const parameterSchema = z.pipe(
  z.object({
    name: nonEmptyString.check(z.refine((name) => !isReservedParameter(name))),
    label: z.string(),
    type: z.catch(z.enum(['text', 'number', 'dropdown', 'combobox', 'multiselect', 'file']), 'text'),
    defaultValue: stringOrEmpty,
    choices: z.catch(z.optional(z.array(z.string())), undefined),
    fileFormats: z.optional(z.unknown()),
    help: z.optional(z.unknown()),
  }),
  z.transform((entry) => {
    const choices = entry.type === 'combobox' || (entry.choices?.length ?? 0) > 0 ? entry.choices : undefined;
    const type = entry.type === 'dropdown' && choices === undefined ? 'text' : entry.type;
    return {
      name: entry.name,
      label: entry.label,
      type,
      defaultValue: type === 'file' ? '' : entry.defaultValue,
      ...((type === 'dropdown' || type === 'combobox' || type === 'multiselect') && choices !== undefined
        ? { choices }
        : {}),
      ...(type === 'file' && isFileFormats(entry.fileFormats) ? { fileFormats: entry.fileFormats } : {}),
      ...(typeof entry.help === 'string' && entry.help !== '' ? { help: entry.help } : {}),
    };
  })
);

const markdownBlockSchema = z.pipe(
  z.object({
    type: z.literal('markdown'),
    id: z.catch(z.optional(nonEmptyString), undefined),
    text: z.string(),
    hideUntilResults: optionalBoolean,
  }),
  z.transform(({ type, id, text, hideUntilResults }) => ({
    type,
    ...(id === undefined ? {} : { id }),
    text,
    ...(hideUntilResults === undefined ? {} : { hideUntilResults }),
  }))
);

const outputBlockSchema = z.pipe(
  z
    .object({
      type: z.literal('output'),
      id: nonEmptyString,
      label: stringOrEmpty,
      nodeId: stringOrEmpty,
      port: z.optional(nonEmptyString),
      kind: z.optional(z.literal('html')),
      chartSpec: z.catch(z.optional(chartSpecSchema), undefined),
      hideUntilResults: optionalBoolean,
      fileOutput: z.optional(z.transform(parseFileOutput)),
      disabled: optionalBoolean,
      parentGroupId: z.catch(z.optional(nonEmptyString), undefined),
    })
    .check(
      z.refine((block) =>
        block.kind === 'html'
          ? block.port === undefined && block.chartSpec === undefined && block.fileOutput === undefined
          : block.port !== undefined
      )
    ),
  z.transform(({ chartSpec, fileOutput, hideUntilResults, disabled, parentGroupId, ...block }) => ({
    ...block,
    ...(chartSpec === undefined ? {} : { chartSpec }),
    ...(fileOutput === undefined ? {} : { fileOutput }),
    ...(hideUntilResults === undefined ? {} : { hideUntilResults }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(parentGroupId === undefined ? {} : { parentGroupId }),
  }))
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
    version: z.literal(8),
    runner: z.optional(runnerSchema),
    appName: nonEmptyString,
    subtitle: z.optional(z.unknown()),
    provenance: z.optional(z.unknown()),
    target: z.optional(z.unknown()),
    storage: z.optional(z.unknown()),
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
      entries.some(
        (entry) =>
          (entry.type === 'file' &&
            (!storage || (entry.fileFormats !== undefined && !isFileFormats(entry.fileFormats)))) ||
          (entry.type === 'multiselect' && !isValidMultiselectConfig(entry.choices, entry.defaultValue))
      )
    ) {
      ctx.issues.push({
        code: 'custom',
        input: raw,
        message: 'Invalid published app configuration',
      });
      return z.NEVER;
    }
    const provenance = provenanceSchema.safeParse(raw.provenance).data;
    const target = targetSchema.safeParse(raw.target).data;
    return {
      ...(storage === undefined ? {} : { storage }),
      ...(raw.runner === undefined ? {} : { runner: raw.runner }),
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
  })
);

export type AppChartSpec = z.output<typeof chartSpecSchema>;
export type AppParameter = z.output<typeof parameterSchema>;
export type AppMarkdownBlock = z.output<typeof markdownBlockSchema>;
export type AppOutputBlock = z.output<typeof outputBlockSchema>;
export type AppManifestBlock = z.output<typeof blockSchema>;
export type AppManifest = z.output<typeof appManifestSchema>;

export const outputBlockTitle = ({ label, nodeId, id }: Pick<AppOutputBlock, 'label' | 'nodeId' | 'id'>): string =>
  label !== '' ? label : nodeId !== '' ? nodeId : id;
