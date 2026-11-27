import { useState } from 'react';
import { labelFor, type Field, VOLUME_KEY } from './lib';

/** Citations are shared: several values usually cite one region. */
function boxesForPage(fields: Field[], page: number | null) {
  const seen = new Map<string, Field[]>();
  for (const f of fields) {
    if (!f.coord || f.page_id !== page) continue;
    const key = f.coord.join(',');
    seen.set(key, [...(seen.get(key) ?? []), f]);
  }
  return [...seen.values()];
}

type Props = { fields: Field[]; selected: Field | undefined };

/** Page image with every cited region outlined; the selected one emphasised. */
export function PageViewer({ fields, selected }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  if (!selected?.image_file) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No page image for this document.
      </div>
    );
  }

  const page = selected.page_id;
  const src = `/api/files/${VOLUME_KEY}/raw?path=${encodeURIComponent(selected.image_file)}`;

  return (
    <div className="flex-1 overflow-auto bg-muted/30 p-4">
      <div className="relative mx-auto max-w-2xl">
        <img
          key={selected.image_file}
          src={src}
          alt="Document page"
          className="block w-full rounded-md border"
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />

        {size &&
          boxesForPage(fields, page)
            .filter((group) => group.some((f) => f.path === selected.path))
            .map((group) => {
              const coord = group[0].coord!;
              const isSelected = group.some((f) => f.path === selected.path);
              const style = {
                left: `${(coord[0] / size.w) * 100}%`,
                top: `${(coord[1] / size.h) * 100}%`,
                width: `${((coord[2] - coord[0]) / size.w) * 100}%`,
                height: `${((coord[3] - coord[1]) / size.h) * 100}%`,
              };
              /*
              Fixed colours, not theme tokens: these overlay the document image,
              which is always white paper. `primary` inverts in dark mode and
              disappears against it.
            */
              const broad = ((coord[2] - coord[0]) * (coord[3] - coord[1])) / (size.w * size.h) > 0.08;

              return (
                <div
                  key={coord.join(',')}
                  className={`absolute rounded-sm ${
                    isSelected
                      ? `border-2 border-blue-600 ${broad ? '' : 'bg-blue-600/15'}`
                      : 'border border-dashed border-blue-600/40'
                  }`}
                  style={style}
                >
                  {isSelected && (
                    <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-blue-600 px-1.5 text-[10px] font-medium leading-5 text-white">
                      {labelFor(selected.type_key)}
                      {broad && ' (region)'}
                      {group.length > 1 && ` +${group.length - 1} more`}
                    </span>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}
