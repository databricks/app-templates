import { useMemo } from 'react';
import { Badge, Input, Button } from '@databricks/appkit-ui/react';
import { confidenceVariant, labelFor, widgetFor, type FieldMeta, type Field } from './lib';

type Props = {
  fields: Field[];
  schema: FieldMeta[];
  selected: string | undefined;
  onSelect: (path: string) => void;
  /** Reviewer edits, keyed by field path. Absent means untouched. */
  edits: Record<string, string>;
  onEdit: (path: string, value: string) => void;
  onApprove: () => void;
  approving: boolean;
  /** Set when this reviewer has already reviewed every value in the document. */
  reviewedAt: string | null;
  error: string | null;
  /** False until the selected document has loaded. */
  loaded: boolean;
};

/** Form generated from the discovered schema, in the order the table returns. */
export function FieldList({
  fields,
  schema,
  selected,
  onSelect,
  edits,
  onEdit,
  onApprove,
  approving,
  reviewedAt,
  error,
  loaded,
}: Props) {
  // Both of these are built once per document instead of once per row: with a
  // scan per row, a document with many fields costs O(N^2) on every keystroke.
  const widgetByType = useMemo(() => new Map(schema.map((s) => [s.field_name, widgetFor(s)])), [schema]);
  const widgetOf = (field: Field) => widgetByType.get(field.type_key) ?? 'text';

  /** Array group name -> how many items it holds. */
  const groupSizes = useMemo(() => {
    const seen = new Map<string, Set<number | null>>();
    for (const f of fields) {
      if (!f.group_name) continue;
      const items = seen.get(f.group_name) ?? new Set<number | null>();
      items.add(f.item_index);
      seen.set(f.group_name, items);
    }
    return new Map([...seen].map(([name, items]) => [name, items.size]));
  }, [fields]);

  const valueOf = (field: Field) => edits[field.path] ?? field.value ?? '';

  /*
    Some AI functions report no confidence at all (ai_classify returns a bare
    value). Treating that as "the model found nothing" would mark every value
    as needing review, so the badges only appear where there is a score.
  */
  const hasConfidence = fields.some((f) => f.confidence !== null);

  /*
    A value the model never found cannot be approved away: with nothing in the
    box there is no agreed value to record, and logging an empty one would
    clear the document from the queue while the gap is still there. Read-only
    nested fields are exempt -- they carry no confidence by design.
  */
  // Blocking depends on emptiness alone, which holds with or without confidence.
  const missing = fields.filter((f) => widgetOf(f) !== 'json' && valueOf(f).trim() === '');
  // No values at all means the AI call failed or found nothing; approving that
  // would record the failure as agreed. The server refuses it too.
  const empty = loaded && fields.length === 0;
  const blocked = !loaded || empty || missing.length > 0;

  /*
    Approving with nothing changed is a real answer, not a no-op: it records
    that this reviewer read the document and agrees with the model. Every
    approval is an independent opinion of the model's own output, so a second
    reviewer who agrees must be able to say so, and the button stays live
    whether or not anything in the form differs.
  */
  const actionLabel = reviewedAt ? 'Approve again' : 'Approve';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Same card frame as the Overview box above it, so the two read as peer
        sections. No hover or cursor affordance though: Overview is a control,
        this is a heading.
      */}
      <div className="mb-4 rounded-md border p-3">
        <h2 className="text-lg font-semibold">Response fields</h2>
        <p className="text-xs text-muted-foreground">{fields.length} values discovered at runtime</p>
      </div>

      {/* Only the field rows scroll; both headings stay put. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {fields.map((field, i) => {
          const widget = widgetOf(field);
          // Nested read-only fields carry no top-level confidence by design, so a
          // null there is not a missing value.
          const unresolved =
            widget !== 'json' && (hasConfidence ? field.confidence === null : valueOf(field).trim() === '');
          const isSelected = field.path === selected;

          // Array leaves arrive grouped and ordered; emit a heading at each change.
          const startsGroup = field.group_name && field.group_name !== fields[i - 1]?.group_name;
          const groupSize = field.group_name ? (groupSizes.get(field.group_name) ?? 0) : 0;

          return (
            <div key={field.path}>
              {startsGroup && (
                <div className="mb-1.5 mt-3 flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold">{labelFor(field.group_name!)}</h3>
                  <span className="text-[10px] text-muted-foreground">{groupSize} items</span>
                </div>
              )}

              <div
                onClick={() => onSelect(field.path)}
                className={`mb-2 cursor-pointer rounded-md border p-2 ${
                  field.group_name ? 'ml-3' : ''
                } ${isSelected ? 'border-primary ring-1 ring-primary' : ''}`}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  {field.item_index !== null && (
                    <span className="text-[10px] text-muted-foreground">#{field.item_index + 1}</span>
                  )}
                  <span className="text-xs font-semibold">{labelFor(field.type_key)}</span>
                  {/* Same fixed blue as the box, so the link to the page reads. */}
                  {isSelected && field.coord && (
                    <Badge
                      variant="outline"
                      className="border-blue-600/40 bg-blue-600/10 text-[10px] text-blue-600 dark:text-blue-400"
                    >
                      on page
                    </Badge>
                  )}
                  <span className="flex-1" />
                  {field.approved_value !== null && (
                    <Badge variant="secondary" className="text-[10px]">
                      corrected
                    </Badge>
                  )}
                  {widget === 'json' ? (
                    <Badge variant="outline" className="text-[10px]">
                      nested
                    </Badge>
                  ) : field.confidence !== null ? (
                    <Badge variant={confidenceVariant(field.confidence)} className="text-[10px]">
                      {`${Math.round(field.confidence * 100)}%`}
                    </Badge>
                  ) : unresolved ? (
                    <Badge variant="destructive" className="text-[10px]">
                      needs review
                    </Badge>
                  ) : null}
                </div>

                {widget === 'json' ? (
                  <pre className="max-h-32 overflow-auto rounded-md border bg-muted/50 p-2 text-[10px]">
                    {field.value ?? '—'}
                  </pre>
                ) : (
                  /*
                    Always type="text". A native number input coerces DECIMAL to a
                    float, so 109303.32 round-trips as 109303.3203125.
                  */
                  <Input
                    type="text"
                    inputMode={widget === 'number' ? 'decimal' : 'text'}
                    value={valueOf(field)}
                    onChange={(e) => onEdit(field.path, e.target.value)}
                    placeholder={unresolved ? 'enter value' : ''}
                    className={
                      unresolved && valueOf(field).trim() === ''
                        ? 'border-destructive placeholder:text-destructive'
                        : ''
                    }
                  />
                )}
                {field.approved_value !== null && (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {field.approved_value} · {field.approver ?? 'a reviewer'} approved
                  </p>
                )}
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {schema.find((s) => s.field_name === field.type_key)?.value_type.replace(/<.*/, '<…>')} · {widget}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {empty && (
        <p className="mt-3 text-xs text-destructive">
          The model returned no values for this document, so there is nothing to approve.
        </p>
      )}
      {missing.length > 0 && (
        <p className="mt-3 text-xs text-destructive">
          {missing.length} value{missing.length === 1 ? '' : 's'} still needs a value before this document can be
          approved.
        </p>
      )}

      <Button className="mt-3 w-full" disabled={blocked || approving} onClick={onApprove}>
        {approving ? 'Saving…' : actionLabel}
      </Button>
    </div>
  );
}
