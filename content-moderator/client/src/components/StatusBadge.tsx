import { Badge } from "@databricks/appkit-ui/react";

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending_review: "secondary",
  approved: "default",
  rejected: "destructive",
  revision_requested: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANTS[status] ?? "outline";
  const label = status.replace(/_/g, " ");
  return <Badge variant={variant}>{label}</Badge>;
}
