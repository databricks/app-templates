import { Badge } from "@databricks/appkit-ui/react";

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  trial: "secondary",
  pending_cancellation: "destructive",
  cancelled: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANTS[status] ?? "outline";
  const label = status.replace(/_/g, " ");
  return <Badge variant={variant}>{label}</Badge>;
}
