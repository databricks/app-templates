import { useState } from 'react';
import {
  useAnalyticsQuery,
  BarChart,
  GenieChat,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold font-mono mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

type Tab = 'dashboard' | 'genie';

const tabClass = (active: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
    active
      ? 'border-foreground text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
  }`;

function DashboardTab() {
  const { data: metrics, loading: metricsLoading } = useAnalyticsQuery('support_metrics', {});
  const latest = metrics && metrics.length > 0 ? metrics[0] : null;

  return (
    <div className="space-y-8">
      {metricsLoading && (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`metric-${i}`} className="h-24 rounded-lg" />
          ))}
        </div>
      )}

      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Cases" value={String(latest.total_cases)} sub={`${latest.open_cases} open`} />
          <MetricCard label="Avg Response Time" value={`${latest.avg_first_response_minutes ?? '—'}m`} />
          <MetricCard
            label="Refund Cases"
            value={String(latest.cases_with_refund)}
            sub={`$${((latest.total_refund_cents as number) / 100).toFixed(2)} total`}
          />
          <MetricCard label="Avg Messages" value={String(latest.avg_messages_per_case)} sub="per case" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent Action Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="agent_performance"
              parameters={{}}
              xKey="action"
              yKey="count"
              height={300}
              colors={['oklch(0.92 0.004 286.32)']}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Avg Suggested Amount by Action</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="agent_performance"
              parameters={{}}
              xKey="action"
              yKey="avg_amount_cents"
              height={300}
              colors={['oklch(0.705 0.015 286.067)']}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GenieTab() {
  return (
    <Card className="flex-1 flex flex-col overflow-hidden">
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="text-sm">Ask Genie</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ask questions about orders, revenue, support cases, customers, and more.
        </p>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <GenieChat alias="default" placeholder="e.g. What was our total revenue this week?" className="h-full" />
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="flex flex-col h-full">
      <div className="max-w-5xl mx-auto w-full px-6 pt-6 pb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <div className="flex gap-1">
          <button type="button" className={tabClass(tab === 'dashboard')} onClick={() => setTab('dashboard')}>
            Dashboard
          </button>
          <button type="button" className={tabClass(tab === 'genie')} onClick={() => setTab('genie')}>
            Ask Genie
          </button>
        </div>
      </div>

      {tab === 'dashboard' && (
        <div className="max-w-5xl mx-auto w-full px-6 py-6">
          <DashboardTab />
        </div>
      )}

      {tab === 'genie' && (
        <div className="max-w-5xl mx-auto w-full px-6 py-4 flex-1 flex flex-col min-h-0">
          <GenieTab />
        </div>
      )}
    </div>
  );
}
