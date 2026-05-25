import { Badge, Input, Skeleton } from '@databricks/appkit-ui/react';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ActionBadge } from '../components/ActionBadge';
import { normaliseToUuid } from '../lib/utils';

interface CaseRow {
  case_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  subject: string;
  status: string;
  case_created_at: string;
  message_count: number;
  has_admin_reply: boolean;
  suggested_action: string | null;
  suggested_amount_cents: number | null;
  case_summary: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'resolved' ? 'outline' : status === 'open' ? 'secondary' : 'default';
  return <Badge variant={variant}>{status}</Badge>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const totalMinutes = Math.floor(diff / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
}

export function CaseQueuePage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/cases')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch cases: ${res.statusText}`);
        return res.json() as Promise<CaseRow[]>;
      })
      .then(setCases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load cases'))
      .finally(() => setLoading(false));
  }, []);

  const query = search.trim().toLowerCase();
  const normalisedUuid = useMemo(() => normaliseToUuid(search), [search]);

  const filtered = query
    ? cases.filter((c) => {
        if (normalisedUuid) {
          if (c.case_id.toLowerCase() === normalisedUuid || c.user_id.toLowerCase() === normalisedUuid) return true;
        }
        return (
          c.case_id.toLowerCase().includes(query) ||
          c.user_id.toLowerCase().includes(query) ||
          c.subject.toLowerCase().includes(query) ||
          c.user_name.toLowerCase().includes(query) ||
          c.user_email.toLowerCase().includes(query) ||
          (c.suggested_action?.toLowerCase().includes(query) ?? false)
        );
      })
    : cases;
  const openCases = filtered.filter((c) => c.status !== 'resolved' && c.status !== 'closed');
  const resolvedCases = filtered.filter((c) => c.status === 'resolved' || c.status === 'closed');

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight shrink-0">Cases</h2>
        <Input
          placeholder="Search by case ID, user ID, subject, or action..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground shrink-0">
          {openCases.length} open &middot; {resolvedCases.length} resolved
        </span>
      </div>

      {error && <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">{error}</div>}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={`skel-${i}`} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-muted-foreground text-center py-16">
          {query ? 'No cases match your search.' : 'No support cases found.'}
        </p>
      )}

      {!loading && openCases.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Needs attention</h3>
          {openCases.map((c) => (
            <button
              key={c.case_id}
              type="button"
              onClick={() => navigate(`/cases/${c.case_id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{c.subject}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <code className="font-mono text-[11px] bg-muted/50 px-1.5 py-0.5 rounded">
                    {c.case_id.slice(0, 8)}
                  </code>
                  <span>{c.user_name}</span>
                  <span>&middot;</span>
                  <span>{c.message_count} messages</span>
                  <span>&middot;</span>
                  <span>{timeAgo(c.case_created_at)}</span>
                </div>
              </div>
              {c.suggested_action && <ActionBadge action={c.suggested_action} amountCents={c.suggested_amount_cents} />}
            </button>
          ))}
        </section>
      )}

      {!loading && resolvedCases.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Resolved</h3>
          {resolvedCases.map((c) => (
            <button
              key={c.case_id}
              type="button"
              onClick={() => navigate(`/cases/${c.case_id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-lg border border-border/30 hover:bg-muted/20 transition-colors opacity-60"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{c.subject}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <code className="font-mono text-[11px] bg-muted/50 px-1.5 py-0.5 rounded">
                    {c.case_id.slice(0, 8)}
                  </code>
                  <span>{c.user_name}</span>
                  <span>&middot;</span>
                  <span>{c.message_count} messages</span>
                </div>
              </div>
              {c.suggested_action && <ActionBadge action={c.suggested_action} amountCents={c.suggested_amount_cents} />}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
