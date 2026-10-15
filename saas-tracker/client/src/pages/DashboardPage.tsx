import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Input, Skeleton } from "@databricks/appkit-ui/react";
import { StatusBadge } from "../components/StatusBadge";
import { formatCurrency, daysUntil } from "../lib/utils";

interface Subscription {
  id: string;
  name: string;
  vendor: string;
  description: string | null;
  category: string;
  cost_cents: number;
  billing_cycle: string;
  currency: string;
  owner_name: string;
  owner_email: string;
  department: string | null;
  license_count: number | null;
  status: string;
  start_date: string;
  renewal_date: string | null;
  cancellation_date: string | null;
  url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function RenewalIndicator({ renewalDate }: { renewalDate: string | null }) {
  const days = daysUntil(renewalDate);
  if (days === null) return null;
  if (days < 0)
    return (
      <span className="text-xs text-destructive font-medium">Overdue</span>
    );
  if (days <= 30)
    return <span className="text-xs text-warning font-medium">{days}d</span>;
  return <span className="text-xs text-muted-foreground">{days}d</span>;
}

export function DashboardPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        return res.json() as Promise<Subscription[]>;
      })
      .then(setSubscriptions)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(subscriptions.map((s) => s.category))].sort(),
    [subscriptions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter)
        return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.vendor.toLowerCase().includes(q) ||
        s.owner_name.toLowerCase().includes(q) ||
        s.owner_email.toLowerCase().includes(q) ||
        (s.department?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [subscriptions, search, statusFilter, categoryFilter]);

  const totalMonthly = useMemo(
    () =>
      filtered
        .filter((s) => s.status === "active" || s.status === "trial")
        .reduce((sum, s) => {
          if (s.billing_cycle === "monthly") return sum + Number(s.cost_cents);
          if (s.billing_cycle === "annual")
            return sum + Math.round(Number(s.cost_cents) / 12);
          return sum;
        }, 0),
    [filtered],
  );

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Subscriptions</h2>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-1">
              {filtered.length} subscriptions &middot;{" "}
              {formatCurrency(totalMonthly)}/mo
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
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="pending_cancellation">Pending cancel</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            placeholder="Search name, vendor, owner..."
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
          {search || statusFilter !== "all" || categoryFilter !== "all"
            ? "No subscriptions match your filters."
            : "No subscriptions yet. Add your first one!"}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_140px_120px_140px_100px_60px] gap-4 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">
            <span>Name / Vendor</span>
            <span>Owner</span>
            <span>Category</span>
            <span>Cost</span>
            <span>Status</span>
            <span>Renewal</span>
          </div>
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/subscriptions/${s.id}`)}
              className="w-full text-left grid grid-cols-[1fr_140px_120px_140px_100px_60px] gap-4 items-center p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.vendor}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm truncate">{s.owner_name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.owner_email}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {s.category}
              </span>
              <div>
                <p className="text-sm font-mono">
                  {formatCurrency(s.cost_cents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  /
                  {s.billing_cycle === "one_time"
                    ? "once"
                    : s.billing_cycle === "annual"
                      ? "yr"
                      : "mo"}
                </p>
              </div>
              <StatusBadge status={s.status} />
              <RenewalIndicator renewalDate={s.renewal_date} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
