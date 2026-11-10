import { Card, CardContent, Skeleton } from "@databricks/appkit-ui/react";
import { formatCurrency } from "../lib/utils";

interface SpendSummary {
  active_count: number;
  cancelled_count: number;
  monthly_spend_cents: number;
  annual_spend_cents: number;
  renewals_next_30d: number;
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <p className="text-2xl font-bold font-mono mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function SpendSummaryCards({
  data,
  loading,
}: {
  data: SpendSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={`spend-skel-${i}`} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="Monthly Spend"
        value={formatCurrency(data.monthly_spend_cents)}
        sub={`${data.active_count} active subscriptions`}
      />
      <MetricCard
        label="Annual Spend"
        value={formatCurrency(data.annual_spend_cents)}
        sub={`${data.cancelled_count} cancelled`}
      />
      <MetricCard
        label="Active"
        value={String(data.active_count)}
        sub="subscriptions"
      />
      <MetricCard
        label="Renewals (30d)"
        value={String(data.renewals_next_30d)}
        sub="coming up"
      />
    </div>
  );
}
