interface KpiCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: "default" | "warning" | "danger" | "success";
}

const VARIANT_CLASSES = {
  default: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  success: "text-success",
};

function KpiCard({ label, value, subtext, variant = "default" }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 space-y-1">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-2xl font-bold tabular-nums ${VARIANT_CLASSES[variant]}`}
      >
        {value}
      </p>
      {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
    </div>
  );
}

interface OverviewData {
  ok_count: number;
  low_count: number;
  critical_count: number;
  out_of_stock_count: number;
  store_count: number;
  product_count: number;
  inventory_value_cents: number;
}

export function KpiCards({ data }: { data: OverviewData }) {
  const alertCount =
    Number(data.critical_count) + Number(data.out_of_stock_count);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KpiCard
        label="Alerts"
        value={alertCount}
        subtext={`${data.critical_count} critical · ${data.out_of_stock_count} out of stock`}
        variant={alertCount > 0 ? "danger" : "success"}
      />
      <KpiCard
        label="Low Stock"
        value={Number(data.low_count)}
        subtext="Approaching reorder point"
        variant={Number(data.low_count) > 0 ? "warning" : "default"}
      />
      <KpiCard
        label="Healthy SKUs"
        value={Number(data.ok_count)}
        subtext={`of ${Number(data.product_count) * Number(data.store_count)} total`}
        variant="success"
      />
      <KpiCard
        label="Inventory Value"
        value={`$${Math.round(Number(data.inventory_value_cents) / 100).toLocaleString()}`}
        subtext={`across ${data.store_count} stores`}
      />
    </div>
  );
}
