import { useState } from 'react';
import { Badge } from '@databricks/appkit-ui/react';
import { BANDS, bandOf, hexOf, labelFor, needsAttention, VOLUME_KEY, type Field } from './lib';

/** Several values usually cite one region, so boxes are grouped by coordinate. */
function groupByPage(fields: Field[]) {
  const pages = new Map<number, Map<string, Field[]>>();
  for (const f of fields) {
    if (!f.coord || f.page_id === null || !f.image_file) continue;
    const page = pages.get(f.page_id) ?? new Map<string, Field[]>();
    const key = f.coord.join(',');
    page.set(key, [...(page.get(key) ?? []), f]);
    pages.set(f.page_id, page);
  }
  return [...pages.entries()].sort((a, b) => a[0] - b[0]);
}

/** The worst value decides, so a shared region cannot hide a bad one. */
const worstOf = (group: Field[]) =>
  group.some((f) => f.confidence === null) ? null : Math.min(...group.map((f) => f.confidence!));

/* ---------- right panel: summary, and the way back to the overview ---------- */

export function OverviewBox({ fields, active, onClick }: { fields: Field[]; active: boolean; onClick: () => void }) {
  /*
    Some AI functions report no confidence at all (ai_classify returns a bare
    value). Treating that as "the model found nothing" would paint every value
    red and make the triage meaningless, so when no field in the document
    carries a score the bands are simply not shown.
  */
  const hasConfidence = fields.some((f) => f.confidence !== null);
  const counts = hasConfidence
    ? BANDS.map((b) => ({
        ...b,
        n: fields.filter((f) => bandOf(f.confidence).key === b.key).length,
      })).filter((b) => b.n > 0)
    : [];
  const attention = hasConfidence ? fields.filter((f) => needsAttention(f.confidence)).length : 0;

  return (
    <div
      onClick={onClick}
      className={`mb-4 cursor-pointer rounded-md border p-3 hover:bg-muted/50 ${
        active ? 'border-primary ring-1 ring-primary' : ''
      }`}
    >
      <h2 className="text-lg font-semibold">Overview</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        {fields.length} values{attention > 0 && ` · ${attention} need attention`}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {counts.map((c) => (
          <span key={c.key} className="flex items-center gap-1.5 text-[10px]">
            <i className="block h-2 w-2 rounded-sm" style={{ background: c.hex }} />
            <span className="font-semibold">{c.n}</span>
            <span className="text-muted-foreground">{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- centre pane: every page, every cited region ---------- */

export function OverviewPages({ fields, onSelect }: { fields: Field[]; onSelect: (path: string) => void }) {
  const pages = groupByPage(fields);

  /*
    Citations are optional. When the output references a page but cites nothing
    in it -- a classification, say -- the page is still worth showing: the
    reviewer has to read the document to judge the label. Only when there is no
    page at all is there nothing to render.
  */
  if (!pages.length) {
    const image = fields.find((f) => f.image_file)?.image_file;
    if (!image) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          This output references no page image.
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-auto bg-muted/30 p-4">
        <div className="mx-auto max-w-2xl">
          <p className="mb-1 text-xs text-muted-foreground">
            No cited regions: this output does not say where its values came from.
          </p>
          <img
            src={`/api/files/${VOLUME_KEY}/raw?path=${encodeURIComponent(image)}`}
            alt="Document page"
            className="block w-full rounded-md border"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-muted/30 p-4">
      <div className="mx-auto max-w-2xl">
        {pages.map(([pageId, boxes]) => (
          <div key={pageId} className="mb-5">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-semibold">Page {pageId + 1}</span>
              <Badge variant="outline" className="text-[10px]">
                {boxes.size} regions
              </Badge>
            </div>
            <PageOverlay
              image={[...boxes.values()][0][0].image_file!}
              boxes={[...boxes.values()]}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/*
  Label geometry, in rendered CSS pixels. The label is absolutely positioned
  against its own box, so only its height and an estimated width are needed to
  tell whether two labels would collide.
*/
const LABEL_H = 16;
const LABEL_CHAR_W = 5.4;
const LABEL_PAD = 8;

/**
 * Choose a vertical slot for every label so no two overlap.
 *
 * Citation boxes often sit directly on top of one another (a one-line field
 * above a table, say), and a label pinned above its box then lands on the box
 * -- or the label -- above it. Boxes are taken top-down; each label tries the
 * slot above its box first, then slots stepping down inside it, and takes the
 * first that clears every label already placed. Returns the chosen offset in
 * CSS pixels relative to the top of the box.
 */
function placeLabels(
  boxes: Field[][],
  text: (group: Field[]) => string,
  natural: { w: number; h: number },
  rendered: number
): Map<string, number> {
  const scale = rendered / natural.w;
  const order = boxes
    .map((group, i) => ({ group, i }))
    .sort((a, b) => a.group[0].coord![1] - b.group[0].coord![1] || a.group[0].coord![0] - b.group[0].coord![0]);

  const placed: { x1: number; x2: number; y1: number; y2: number }[] = [];
  const offsets = new Map<string, number>();

  for (const { group } of order) {
    const c = group[0].coord!;
    const left = c[0] * scale;
    const top = c[1] * scale;
    const width = text(group).length * LABEL_CHAR_W + LABEL_PAD;
    const height = (c[3] - c[1]) * scale;

    // Above the box, then stepping down inside it, never past its bottom edge.
    const candidates = [-LABEL_H];
    for (let o = 0; o + LABEL_H <= Math.max(height, LABEL_H); o += LABEL_H) candidates.push(o);

    const offset =
      candidates.find((o) => {
        const rect = { x1: left, x2: left + width, y1: top + o, y2: top + o + LABEL_H };
        return !placed.some((q) => rect.x1 < q.x2 && q.x1 < rect.x2 && rect.y1 < q.y2 && q.y1 < rect.y2);
      }) ?? -LABEL_H;

    placed.push({ x1: left, x2: left + width, y1: top + offset, y2: top + offset + LABEL_H });
    offsets.set(c.join(','), offset);
  }

  return offsets;
}

function PageOverlay({
  image,
  boxes,
  onSelect,
}: {
  image: string;
  boxes: Field[][];
  onSelect: (path: string) => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number; rendered: number } | null>(null);

  const labelOf = (group: Field[]) => labelFor(group[0].type_key) + (group.length > 1 ? ` +${group.length - 1}` : '');

  const offsets = size ? placeLabels(boxes, labelOf, size, size.rendered) : null;

  return (
    <div className="relative">
      <img
        src={`/api/files/${VOLUME_KEY}/raw?path=${encodeURIComponent(image)}`}
        alt="Document page"
        className="block w-full rounded-md border"
        onLoad={(e) =>
          setSize({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
            rendered: e.currentTarget.clientWidth,
          })
        }
      />
      {size &&
        offsets &&
        boxes.map((group) => {
          const c = group[0].coord!;
          const hex = hexOf(worstOf(group));
          return (
            <div
              key={c.join(',')}
              onClick={() => onSelect(group[0].path)}
              className="absolute cursor-pointer rounded-sm"
              style={{
                left: `${(c[0] / size.w) * 100}%`,
                top: `${(c[1] / size.h) * 100}%`,
                width: `${((c[2] - c[0]) / size.w) * 100}%`,
                height: `${((c[3] - c[1]) / size.h) * 100}%`,
                border: `2px solid ${hex}`,
                background: `${hex}1f`,
              }}
            >
              <span
                className="absolute left-0 whitespace-nowrap rounded px-1 text-[9px] font-medium leading-4 text-white"
                style={{ background: hex, top: `${offsets.get(c.join(',')) ?? -LABEL_H}px` }}
              >
                {labelOf(group)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
