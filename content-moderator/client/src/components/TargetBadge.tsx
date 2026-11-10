import { Badge } from "@databricks/appkit-ui/react";
import { targetLabel } from "../lib/utils";

export function TargetBadge({ target }: { target: string }) {
  return <Badge variant="outline">{targetLabel(target)}</Badge>;
}
