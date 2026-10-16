import { cn } from "@/lib/utils";

type StockStatus = "ok" | "low" | "critical" | "out_of_stock";

const STATUS_CONFIG: Record<StockStatus, { label: string; className: string }> =
  {
    ok: {
      label: "OK",
      className: "bg-success/20 text-success border-success/30",
    },
    low: {
      label: "Low",
      className: "bg-warning/20 text-warning border-warning/30",
    },
    critical: {
      label: "Critical",
      className: "bg-destructive/20 text-destructive border-destructive/30",
    },
    out_of_stock: {
      label: "Out of Stock",
      className:
        "bg-destructive/30 text-destructive border-destructive/50 font-semibold",
    },
  };

export function StockStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as StockStatus] ?? {
    label: status,
    className: "bg-muted text-muted-foreground border-border",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs border",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
