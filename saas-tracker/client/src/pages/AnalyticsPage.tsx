import { useState } from "react";
import {
  useAnalyticsQuery,
  BarChart,
  GenieChat,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@databricks/appkit-ui/react";
import { SpendSummaryCards } from "../components/SpendSummaryCards";

type Tab = "dashboard" | "genie";

const tabClass = (active: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
    active
      ? "border-foreground text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
  }`;

function DashboardTab() {
  const { data: overview, loading: overviewLoading } = useAnalyticsQuery(
    "spend_overview",
    {},
  );
  const latest = overview && overview.length > 0 ? overview[0] : null;

  return (
    <div className="space-y-8">
      <SpendSummaryCards
        data={
          latest
            ? {
                active_count: Number(latest.active_count),
                cancelled_count: Number(latest.cancelled_count),
                monthly_spend_cents: Number(latest.monthly_spend_cents),
                annual_spend_cents: Number(latest.annual_spend_cents),
                renewals_next_30d: Number(latest.renewals_next_30d),
              }
            : null
        }
        loading={overviewLoading}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Monthly Spend by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="spend_by_category"
              parameters={{}}
              xKey="category"
              yKey="monthly_spend_cents"
              height={300}
              colors={["oklch(0.92 0.004 286.32)"]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Subscriptions by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="spend_by_category"
              parameters={{}}
              xKey="category"
              yKey="subscription_count"
              height={300}
              colors={["oklch(0.705 0.015 286.067)"]}
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
          Ask questions about SaaS spend, subscriptions, renewals, and owners.
        </p>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <GenieChat
          alias="default"
          placeholder="e.g. What is our total monthly spend on engineering tools?"
          className="h-full"
        />
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="flex flex-col h-full">
      <div className="max-w-5xl mx-auto w-full px-6 pt-6 pb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <div className="flex gap-1">
          <button
            type="button"
            className={tabClass(tab === "dashboard")}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={tabClass(tab === "genie")}
            onClick={() => setTab("genie")}
          >
            Ask Genie
          </button>
        </div>
      </div>

      {tab === "dashboard" && (
        <div className="max-w-5xl mx-auto w-full px-6 py-6">
          <DashboardTab />
        </div>
      )}

      {tab === "genie" && (
        <div className="max-w-5xl mx-auto w-full px-6 py-4 flex-1 flex flex-col min-h-0">
          <GenieTab />
        </div>
      )}
    </div>
  );
}
