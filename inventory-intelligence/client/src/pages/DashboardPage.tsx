import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Skeleton } from "@databricks/appkit-ui/react";
import { KpiCards } from "@/components/KpiCards";
import { StockStatusBadge } from "@/components/StockStatusBadge";

interface OverviewData {
  ok_count: number;
  low_count: number;
  critical_count: number;
  out_of_stock_count: number;
  store_count: number;
  product_count: number;
  inventory_value_cents: number;
}

interface Alert {
  store_id: string;
  store_name: string;
  region: string;
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  quantity_on_hand: number;
  quantity_on_order: number;
  reorder_point: number;
  days_of_supply: number | null;
  stock_status: string;
  forecast_30d_units: number | null;
  recommended_order_qty: number | null;
  confidence: string | null;
}

interface StoreRow {
  store_id: string;
  store_name: string;
  region: string;
  city: string;
  total_skus: number;
  ok_count: number;
  low_count: number;
  critical_count: number;
  out_of_stock_count: number;
}

export function DashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch("/api/overview").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/alerts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/stores").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([ov, al, st]) => {
        setOverview(ov as OverviewData | null);
        setAlerts(Array.isArray(al) ? (al as Alert[]) : []);
        setStores(Array.isArray(st) ? (st as StoreRow[]) : []);
      })
      .catch((err) => {
        console.error(err);
        setError(
          "Failed to load inventory data. Check that the pipeline has run and sync tables are available.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Inventory Overview
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Stock health across all stores and products
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`kpi-${i}`} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : overview ? (
        <KpiCards data={overview} />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Store Health Summary */}
        <section className="space-y-3">
          <h3 className="text-base font-semibold">Stores</h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={`store-${i}`} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {stores.map((s) => {
                const alerts =
                  Number(s.critical_count) + Number(s.out_of_stock_count);
                return (
                  <button
                    key={s.store_id}
                    type="button"
                    onClick={() => navigate(`/stores/${s.store_id}`)}
                    className="w-full text-left p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{s.store_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.city} · {s.region}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {alerts > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-destructive/20 text-destructive border border-destructive/30">
                            {alerts} alert{alerts > 1 ? "s" : ""}
                          </span>
                        )}
                        {Number(s.low_count) > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-warning/20 text-warning border border-warning/30">
                            {s.low_count} low
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {s.total_skus} SKUs
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Alerts */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Alerts</h3>
            <button
              type="button"
              onClick={() => navigate("/replenishment")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View replenishment queue →
            </button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={`alert-${i}`} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No stock alerts — all products are healthy.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {alerts.map((a) => (
                <button
                  key={`${a.store_id}-${a.product_id}`}
                  type="button"
                  onClick={() => navigate(`/stores/${a.store_id}`)}
                  className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {a.product_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.store_name} · {a.sku}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StockStatusBadge status={a.stock_status} />
                      {a.days_of_supply !== null && (
                        <span className="text-xs text-muted-foreground">
                          {Number(a.days_of_supply).toFixed(1)}d supply
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
