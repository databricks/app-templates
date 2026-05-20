import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { Input, Skeleton } from "@databricks/appkit-ui/react";
import { StockStatusBadge } from "@/components/StockStatusBadge";

interface StockRow {
  store_name: string;
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  unit_cost_cents: number;
  reorder_point: number;
  reorder_quantity: number;
  lead_time_days: number;
  quantity_on_hand: number;
  quantity_on_order: number;
  avg_daily_units_30d: number;
  units_7d: number;
  units_30d: number;
  days_of_supply: number | null;
  stock_status: string;
  last_counted_at: string;
  forecast_30d_units: number | null;
  recommended_order_qty: number | null;
  confidence: string | null;
  model_used: string | null;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-success",
  medium: "text-warning",
  low: "text-muted-foreground",
};

function DaysOfSupplyBar({ days }: { days: number | null }) {
  if (days === null)
    return <span className="text-muted-foreground text-xs">—</span>;
  const capped = Math.min(days, 60);
  const pct = (capped / 60) * 100;
  const color =
    days <= 5 ? "bg-destructive" : days <= 14 ? "bg-warning" : "bg-success";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {Number(days).toFixed(1)}d
      </span>
    </div>
  );
}

export function StoreViewPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!storeId) return;
    fetch(`/api/stores/${storeId}/stock`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setStock(Array.isArray(data) ? (data as StockRow[]) : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId]);

  const categories = useMemo(
    () => [...new Set(stock.map((s) => s.category))].sort(),
    [stock],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stock.filter((s) => {
      if (statusFilter !== "all" && s.stock_status !== statusFilter)
        return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter)
        return false;
      if (!q) return true;
      return (
        s.product_name.toLowerCase().includes(q) ||
        s.sku.toLowerCase().includes(q)
      );
    });
  }, [stock, search, categoryFilter, statusFilter]);

  const storeName = stock[0]?.store_name ?? storeId ?? "Store";

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Dashboard
        </button>
        <span className="text-muted-foreground">/</span>
        <h2 className="text-xl font-bold tracking-tight">{storeName}</h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search product or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="critical">Critical</option>
          <option value="low">Low</option>
          <option value="ok">OK</option>
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
        {!loading && (
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} of {stock.length} SKUs
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={`row-${i}`} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_100px_90px_100px_100px_140px_130px] gap-4 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">
            <span>Product</span>
            <span>Status</span>
            <span>On Hand</span>
            <span>On Order</span>
            <span>Sold 30d</span>
            <span>Days of Supply</span>
            <span>Forecast 30d</span>
          </div>

          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-16 text-sm">
              No products match your filters.
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((row) => (
                <div
                  key={row.product_id}
                  className="grid grid-cols-[1fr_100px_90px_100px_100px_140px_130px] gap-4 items-center px-4 py-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {row.product_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.sku} · {row.category}
                    </p>
                  </div>
                  <StockStatusBadge status={row.stock_status} />
                  <span className="text-sm tabular-nums">
                    {row.quantity_on_hand}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {Number(row.quantity_on_order) > 0
                      ? `+${row.quantity_on_order}`
                      : "—"}
                  </span>
                  <span className="text-sm tabular-nums">
                    {row.units_30d ?? "—"}
                  </span>
                  <DaysOfSupplyBar days={row.days_of_supply} />
                  <div>
                    {row.forecast_30d_units !== null ? (
                      <div>
                        <p className="text-sm tabular-nums">
                          {Math.round(Number(row.forecast_30d_units))} units
                        </p>
                        {row.confidence && (
                          <p
                            className={`text-xs ${CONFIDENCE_COLORS[row.confidence] ?? "text-muted-foreground"}`}
                          >
                            {row.confidence} confidence
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No forecast
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
