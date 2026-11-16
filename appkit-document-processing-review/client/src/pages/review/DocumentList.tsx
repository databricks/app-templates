import { Badge } from '@databricks/appkit-ui/react';
import { shortLabels, type Document } from './lib';

type Props = {
  documents: Document[];
  pending: number;
  selected: string | undefined;
  onSelect: (id: string) => void;
};

/**
 * Review queue, pending first. Approval is per document now, so the badge is a
 * state and not a count: an approved document carries its approver, a pending
 * one carries nothing, which keeps the list quiet until there is something to say.
 */
export function DocumentList({ documents, pending, selected, onSelect }: Props) {
  const labels = shortLabels(documents.map((d) => d.id));

  return (
    <div className="w-60 shrink-0 overflow-auto border-r p-4">
      {/* Section headings match the app title, so no panel outranks another. */}
      <h2 className="text-lg font-semibold">Documents</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {pending} of {documents.length} pending
      </p>

      {documents.map((doc) => (
        <div
          key={doc.id}
          onClick={() => onSelect(doc.id)}
          className={`mb-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
            doc.id === selected ? 'bg-muted' : 'hover:bg-muted/50'
          }`}
        >
          <span className="flex-1 truncate text-sm" title={doc.id}>
            {labels[doc.id]}
          </span>
          {/*
            Both states are labelled so an absent badge can never read as "not
            loaded yet". `approved` stays the louder of the two: it is the
            terminal state and usually the minority, so it should catch the eye,
            while `pending` only removes doubt.
          */}
          {doc.approved ? (
            <Badge variant="outline" className="text-[10px]" title={doc.approver ?? undefined}>
              approved
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] text-muted-foreground">
              pending
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
