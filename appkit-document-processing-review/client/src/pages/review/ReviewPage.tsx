import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { DocumentList } from './DocumentList';
import { OverviewBox, OverviewPages } from './Overview';
import { PageViewer } from './PageViewer';
import { FieldList } from './FieldList';
import { shortLabels, type Document, type Field, type FieldMeta } from './lib';
import { walk, valuesByPath } from './walk';

type DocRow = {
  id: string;
  approved: unknown;
  approver: string | null;
  approved_at: string | null;
  approval_count: unknown;
};

type DetailRow = {
  response: string | null;
  approved_response: string | null;
  approver: string | null;
  approved_at: string | null;
};

const asBool = (v: unknown) => v === true || String(v) === 'true';

export function ReviewPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);

  const [docId, setDocId] = useState<string>();
  const [detail, setDetail] = useState<DetailRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [fieldPath, setFieldPath] = useState<string>();
  const [view, setView] = useState<'overview' | 'review'>('overview');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  /** Covers the gap between a successful write and the next queue load. */
  const [approvedAt, setApprovedAt] = useState<Record<string, string>>({});

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const res = await fetch('/api/documents');
      const body = (await res.json()) as DocRow[] | { error?: string };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setDocuments(
        (body as DocRow[]).map((r) => ({
          id: String(r.id),
          approved: asBool(r.approved),
          approver: r.approver ?? null,
          approved_at: r.approved_at ?? null,
        }))
      );
      setQueueError(null);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Failed to load the queue');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Select the top of the queue exactly once, and only when it is complete.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || docId || loadingQueue || !documents.length) return;
    autoSelected.current = true;
    setDocId(documents[0].id);
  }, [docId, loadingQueue, documents]);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setLoadingDetail(true);
    void (async () => {
      try {
        const res = await fetch(`/api/document?id=${encodeURIComponent(docId)}`);
        const body = (await res.json()) as DetailRow | { error?: string };
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        if (!cancelled) setDetail(body as DetailRow);
      } catch (err) {
        if (!cancelled) setApproveError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  /* ---- shape discovery: everything below comes from the walker ---- */

  /*
    `to_json(...)` returns a STRING, but AppKit sometimes hands it over already
    parsed, so accept either rather than assuming one.
  */
  const asJson = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    }
    return v;
  };

  const model = asJson(detail?.response);
  const approvedDoc = asJson(detail?.approved_response);
  const walked = model ? walk(model) : null;
  const approvedValues = approvedDoc ? valuesByPath(approvedDoc) : new Map<string, string | null>();

  const fields: Field[] = (walked?.leaves ?? []).map((leaf) => {
    const approvedValue = approvedValues.get(leaf.path) ?? null;
    // Evidence: carried on the leaf (parse output) or resolved through a citation.
    const citation = leaf.citationIds.length ? walked!.citations.get(leaf.citationIds[0]) : undefined;
    const coord = leaf.coord ?? citation?.coord ?? null;
    const pageId = leaf.pageId ?? citation?.pageId ?? null;
    const firstPage = walked!.pageImages.keys().next();
    const imagePage = pageId ?? (firstPage.done ? null : firstPage.value);
    return {
      path: leaf.path,
      type_key: leaf.typeKey,
      group_name: leaf.groupName,
      item_index: leaf.itemIndex,
      value: approvedValue ?? leaf.value,
      model_value: leaf.value,
      confidence: leaf.confidence,
      approver: approvedDoc ? (detail?.approver ?? null) : null,
      approved_at: approvedDoc ? (detail?.approved_at ?? null) : null,
      human_changed: approvedValue !== null && approvedValue !== leaf.value,
      coord,
      page_id: pageId,
      image_file: imagePage === null ? null : (walked!.pageImages.get(imagePage) ?? null),
    };
  });

  const schema: FieldMeta[] = [
    ...new Map(
      (walked?.leaves ?? []).map((l) => [
        l.typeKey,
        {
          field_name: l.typeKey,
          value_type: l.kind === 'number' ? 'DECIMAL' : l.kind === 'json' ? 'OBJECT' : 'STRING',
        },
      ])
    ).values(),
  ];

  const docMeta = documents.find((d) => d.id === docId);
  const reviewedAt =
    (approvedDoc ? (detail?.approved_at ?? null) : null) ?? (docId ? (approvedAt[docId] ?? null) : null);
  const reviewedBy = detail?.approver ?? null;

  const selectedField = fields.find((f) => f.path === fieldPath) ?? fields[0];
  const label = docId ? shortLabels(documents.map((d) => d.id))[docId] : '';

  const select = (path: string) => {
    setFieldPath(path);
    setView('review');
  };

  const approve = async () => {
    if (!docId) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, edits }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setApprovedAt((prev) => ({ ...prev, [docId]: new Date().toISOString() }));
      setEdits({});
      await loadQueue();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  };

  if (queueError) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-semibold">{queueError}</p>
        <p className="mt-1 text-xs">
          Set <code>INPUT_TABLE</code> to your <code>catalog.schema.table</code>, then run <code>npm run setup</code> to
          create the approval log and view.
        </p>
      </div>
    );
  }
  if (loadingQueue) return <Skeleton className="h-96 w-full" />;

  const pendingCount = documents.filter((d) => !d.approved && !(d.id in approvedAt)).length;

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border bg-background">
      <DocumentList
        documents={documents.map((d) => (d.id in approvedAt ? { ...d, approved: true } : d))}
        pending={pendingCount}
        selected={docId}
        onSelect={(id) => {
          setDocId(id);
          setFieldPath(undefined);
          setView('overview');
          setEdits({});
          setApproveError(null);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-4 py-2">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold">{label}</span>
            {reviewedAt && <span className="text-xs text-muted-foreground">Approved by {reviewedBy ?? 'you'}</span>}
          </div>
          <div className="break-all text-xs text-muted-foreground">{docId}</div>
        </div>
        {loadingDetail ? (
          <Skeleton className="m-4 flex-1" />
        ) : view === 'overview' ? (
          <OverviewPages fields={fields} onSelect={select} />
        ) : (
          <PageViewer fields={fields} selected={selectedField} />
        )}
      </div>

      <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l p-4">
        <OverviewBox fields={fields} active={view === 'overview'} onClick={() => setView('overview')} />
        <FieldList
          fields={fields}
          schema={schema}
          selected={view === 'review' ? selectedField?.path : undefined}
          onSelect={select}
          edits={edits}
          onEdit={(path, value) => setEdits((prev) => ({ ...prev, [path]: value }))}
          onApprove={() => {
            void approve();
          }}
          approving={approving}
          reviewedAt={reviewedAt}
          error={approveError}
        />
        {docMeta?.approved && <p className="mt-2 text-[10px] text-muted-foreground">{docMeta.approver}</p>}
      </div>
    </div>
  );
}
