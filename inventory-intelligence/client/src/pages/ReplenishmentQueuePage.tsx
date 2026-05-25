import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@databricks/appkit-ui/react";
import { formatDate, daysUntil } from "@/lib/utils";

interface Recommendation {
  store_id: string;
  store_name: string;
  region: string;
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  lead_time_days: number;
  forecast_30d_units: number;
  recommended_order_qty: number;
  confidence: string;
  model_used: string;
  generated_at: string;
  quantity_on_hand: number;
  quantity_on_order: number;
  open_order_id: string | null;
  open_order_status: string | null;
  open_order_qty: number | null;
  expected_delivery_at: string | null;
}

const CONFIDENCE_CONFIG: Record<string, { label: string; className: string }> =
  {
    high: { label: "High", className: "text-success" },
    medium: { label: "Medium", className: "text-warning" },
    low: { label: "Low", className: "text-muted-foreground" },
  };

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cfg = CONFIDENCE_CONFIG[confidence] ?? {
    label: confidence,
    className: "text-muted-foreground",
  };
  return (
    <span className={`text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

function ApproveDialog({
  rec,
  onApprove,
  onClose,
}: {
  rec: Recommendation;
  onApprove: (qty: number) => Promise<void>;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(String(rec.recommended_order_qty));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(qty, 10);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onApprove(parsed);
      onClose();
    } catch {
      setError("Failed to place order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className="text-base font-semibold">Approve Replenishment Order</h3>
        <div className="text-sm space-y-1 text-muted-foreground">
          <p>
            <span className="text-foreground font-medium">
              {rec.product_name}
            </span>{" "}
            · {rec.sku}
          </p>
          <p>
            {rec.store_name} ({rec.region})
          </p>
          <p>
            Lead time: {rec.lead_time_days} days · Est. delivery{" "}
            {formatDate(
              new Date(
                Date.now() + rec.lead_time_days * 86400000,
              ).toISOString(),
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Quantity to Order
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              AI recommended: {rec.recommended_order_qty} units (forecast:{" "}
              {Math.round(Number(rec.forecast_30d_units))} in 30d)
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Placing..." : "Place Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReplenishmentQueuePage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Recommendation | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const loadRecs = useCallback(() => {
    setLoading(true);
    fetch("/api/replenishment")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) =>
        setRecs(Array.isArray(data) ? (data as Recommendation[]) : []),
      )
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRecs();
  }, [loadRecs]);

  const handleApprove = async (rec: Recommendation, qty: number) => {
    await fetch(
      `/api/replenishment/${rec.store_id}/${rec.product_id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity_ordered: qty }),
      },
    ).then((r) => {
      if (!r.ok) throw new Error("Failed");
      return r.json();
    });
    setApproved((prev) =>
      new Set(prev).add(`${rec.store_id}-${rec.product_id}`),
    );
  };

  const pendingRecs = recs.filter(
    (r) => !r.open_order_id && !approved.has(`${r.store_id}-${r.product_id}`),
  );
  const orderedRecs = recs.filter(
    (r) => r.open_order_id || approved.has(`${r.store_id}-${r.product_id}`),
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Replenishment Queue
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          AI-generated order recommendations based on demand forecasts
        </p>
      </div>

      {!loading && recs.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {pendingRecs.length}
          </span>{" "}
          pending ·
          <span className="font-medium text-foreground">
            {orderedRecs.length}
          </span>{" "}
          ordered
          <span className="ml-2 text-xs">
            · Model: {recs[0]?.model_used ?? "—"}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={`rec-${i}`} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {pendingRecs.length === 0 && orderedRecs.length === 0 && (
            <p className="text-muted-foreground text-center py-16">
              No replenishment recommendations. Run the demand forecast job
              first.
            </p>
          )}

          {pendingRecs.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Pending Approval
              </h3>
              <div className="grid grid-cols-[1fr_110px_90px_100px_90px_110px_auto] gap-4 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">
                <span>Product / Store</span>
                <span>Forecast 30d</span>
                <span>On Hand</span>
                <span>Recommend</span>
                <span>Confidence</span>
                <span>Lead Time</span>
                <span />
              </div>
              {pendingRecs.map((rec) => (
                <div
                  key={`${rec.store_id}-${rec.product_id}`}
                  className="grid grid-cols-[1fr_110px_90px_100px_90px_110px_auto] gap-4 items-center px-4 py-3 rounded-lg border border-border/50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {rec.product_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {rec.store_name} · {rec.sku}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">
                    {Math.round(Number(rec.forecast_30d_units))} units
                  </span>
                  <span className="text-sm tabular-nums">
                    {rec.quantity_on_hand}
                  </span>
                  <span className="text-sm tabular-nums font-semibold">
                    {rec.recommended_order_qty}
                  </span>
                  <ConfidenceBadge confidence={rec.confidence} />
                  <span className="text-sm text-muted-foreground">
                    {rec.lead_time_days}d
                  </span>
                  <button
                    type="button"
                    onClick={() => setApproving(rec)}
                    className="px-3 py-1.5 text-xs rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors whitespace-nowrap"
                  >
                    Approve
                  </button>
                </div>
              ))}
            </section>
          )}

          {orderedRecs.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Orders in Progress
              </h3>
              {orderedRecs.map((rec) => {
                const days = daysUntil(rec.expected_delivery_at);
                return (
                  <div
                    key={`${rec.store_id}-${rec.product_id}`}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-border/30 bg-muted/10"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">{rec.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {rec.store_name} · {rec.sku}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm shrink-0">
                      <span className="text-muted-foreground">
                        {rec.open_order_qty ?? rec.recommended_order_qty} units
                      </span>
                      <span className="capitalize text-muted-foreground">
                        {rec.open_order_status ?? "ordered"}
                      </span>
                      {days !== null && (
                        <span
                          className={`text-xs ${days < 0 ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {days > 0
                            ? `Arriving in ${days}d`
                            : days === 0
                              ? "Arriving today"
                              : `Overdue by ${-days}d`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {approving && (
        <ApproveDialog
          rec={approving}
          onApprove={(qty) => handleApprove(approving, qty)}
          onClose={() => {
            setApproving(null);
            loadRecs();
          }}
        />
      )}
    </div>
  );
}
