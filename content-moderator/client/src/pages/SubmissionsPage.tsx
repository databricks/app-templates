import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Input, Skeleton } from "@databricks/appkit-ui/react";
import { StatusBadge } from "../components/StatusBadge";
import { TargetBadge } from "../components/TargetBadge";
import { ScoreBadge } from "../components/ScoreBadge";
import { timeAgo } from "../lib/utils";

interface SubmissionRow {
  id: string;
  title: string;
  body: string;
  target: string;
  author_name: string;
  author_email: string;
  status: string;
  created_at: string;
  updated_at: string;
  compliance_score: number | null;
  ai_issues: string | null;
}

export function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/submissions")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        return res.json() as Promise<SubmissionRow[]>;
      })
      .then(setSubmissions)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, []);

  const targets = useMemo(
    () => [...new Set(submissions.map((s) => s.target))].sort(),
    [submissions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (targetFilter !== "all" && s.target !== targetFilter) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.author_name.toLowerCase().includes(q) ||
        s.author_email.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q)
      );
    });
  }, [submissions, search, statusFilter, targetFilter]);

  const pendingCount = submissions.filter(
    (s) => s.status === "pending_review",
  ).length;

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Review Queue</h2>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-1">
              {filtered.length} submissions &middot; {pendingCount} pending
              review
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending_review">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_requested">Revision requested</option>
          </select>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="all">All targets</option>
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Input
            placeholder="Search title, author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>

      {error && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={`skel-${i}`} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-muted-foreground text-center py-16">
          {search || statusFilter !== "all" || targetFilter !== "all"
            ? "No submissions match your filters."
            : "No submissions yet."}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_140px_120px_100px_80px_80px] gap-4 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">
            <span>Title</span>
            <span>Author</span>
            <span>Target</span>
            <span>Status</span>
            <span>AI Score</span>
            <span>Submitted</span>
          </div>
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/submissions/${s.id}`)}
              className="w-full text-left grid grid-cols-[1fr_140px_120px_100px_80px_80px] gap-4 items-center p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{s.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.body.slice(0, 80)}
                  {s.body.length > 80 ? "..." : ""}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm truncate">{s.author_name}</p>
              </div>
              <TargetBadge target={s.target} />
              <StatusBadge status={s.status} />
              <ScoreBadge score={s.compliance_score} />
              <span className="text-xs text-muted-foreground">
                {timeAgo(s.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
