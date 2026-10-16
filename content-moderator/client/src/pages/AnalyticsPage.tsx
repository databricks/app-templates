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

type Tab = "dashboard" | "genie";

const tabClass = (active: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
    active
      ? "border-foreground text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
  }`;

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          {loading ? (
            <div className="h-8 w-16 bg-muted/30 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardTab() {
  const { data: overview, loading: overviewLoading } = useAnalyticsQuery(
    "content_overview",
    {},
  );
  const latest = overview && overview.length > 0 ? overview[0] : null;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Submissions"
          value={latest ? Number(latest.total_submissions) : 0}
          loading={overviewLoading}
        />
        <SummaryCard
          label="Pending Review"
          value={latest ? Number(latest.pending_count) : 0}
          loading={overviewLoading}
        />
        <SummaryCard
          label="Approved"
          value={latest ? Number(latest.approved_count) : 0}
          loading={overviewLoading}
        />
        <SummaryCard
          label="Avg AI Score"
          value={latest ? Number(latest.avg_compliance_score) : 0}
          loading={overviewLoading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Submissions by Target</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="submissions_by_target"
              parameters={{}}
              xKey="target"
              yKey="submission_count"
              height={300}
              colors={["oklch(0.92 0.004 286.32)"]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Avg Compliance Score by Target
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="submissions_by_target"
              parameters={{}}
              xKey="target"
              yKey="avg_score"
              height={300}
              colors={["oklch(0.67 0.12 167)"]}
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
          Ask questions about content submissions, approval rates, compliance
          scores, and guidelines.
        </p>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <GenieChat
          alias="default"
          placeholder="e.g. Which content target has the lowest average compliance score?"
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
