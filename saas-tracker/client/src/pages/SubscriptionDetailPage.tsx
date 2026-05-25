import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Skeleton,
} from "@databricks/appkit-ui/react";
import { StatusBadge } from "../components/StatusBadge";
import { SubscriptionForm } from "../components/SubscriptionForm";
import { formatCurrency, formatDate, daysUntil } from "../lib/utils";

interface Subscription {
  id: string;
  name: string;
  vendor: string;
  description: string | null;
  category: string;
  cost_cents: number;
  billing_cycle: string;
  currency: string;
  owner_name: string;
  owner_email: string;
  department: string | null;
  license_count: number | null;
  status: string;
  start_date: string;
  renewal_date: string | null;
  cancellation_date: string | null;
  url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  );
}

export function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/subscriptions/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<Subscription>;
      })
      .then(setSub)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatusChange(newStatus: string) {
    if (!id) return;
    const res = await fetch(`/api/subscriptions/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await fetch(`/api/subscriptions/${id}`);
      if (updated.ok) setSub(await updated.json());
    }
  }

  async function handleDelete() {
    if (!id || !confirm("Delete this subscription?")) return;
    const res = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    if (res.ok) navigate("/");
  }

  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !sub) {
    return (
      <div className="w-full max-w-4xl mx-auto px-6 py-8">
        <div className="text-destructive bg-destructive/10 p-4 rounded-md">
          {error ?? "Subscription not found"}
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="w-full max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Edit {sub.name}</h2>
          <Button variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <SubscriptionForm
          initialData={{
            ...sub,
            description: sub.description ?? "",
            department: sub.department ?? "",
            license_count: sub.license_count ? String(sub.license_count) : "",
            renewal_date: sub.renewal_date ?? "",
            url: sub.url ?? "",
            notes: sub.notes ?? "",
          }}
          submitLabel="Save Changes"
          onSubmit={async (data) => {
            const body = {
              ...data,
              license_count: data.license_count
                ? parseInt(data.license_count, 10)
                : undefined,
              renewal_date: data.renewal_date || undefined,
              url: data.url || undefined,
              description: data.description || undefined,
              department: data.department || undefined,
              notes: data.notes || undefined,
            };
            const res = await fetch(`/api/subscriptions/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error("Failed to update");
            const refreshed = await fetch(`/api/subscriptions/${id}`);
            if (refreshed.ok) setSub(await refreshed.json());
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const renewalDays = daysUntil(sub.renewal_date);

  return (
    <div className="w-full max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{sub.name}</h2>
            <StatusBadge status={sub.status} />
            {renewalDays !== null && renewalDays <= 30 && renewalDays >= 0 && (
              <Badge variant="destructive">Renews in {renewalDays}d</Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">{sub.vendor}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Subscription Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            <DetailRow
              label="Cost"
              value={`${formatCurrency(sub.cost_cents)} / ${sub.billing_cycle}`}
            />
            <DetailRow label="Category" value={sub.category} />
            <DetailRow label="Billing Cycle" value={sub.billing_cycle} />
            <DetailRow
              label="License Count"
              value={sub.license_count ? String(sub.license_count) : null}
            />
            <DetailRow label="Start Date" value={formatDate(sub.start_date)} />
            <DetailRow
              label="Renewal Date"
              value={formatDate(sub.renewal_date)}
            />
            {sub.cancellation_date && (
              <DetailRow
                label="Cancelled On"
                value={formatDate(sub.cancellation_date)}
              />
            )}
            {sub.url && (
              <div className="flex justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Admin URL</span>
                <a
                  href={sub.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline"
                >
                  Open
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Owner & Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            <DetailRow label="Owner" value={sub.owner_name} />
            <DetailRow label="Email" value={sub.owner_email} />
            <DetailRow label="Department" value={sub.department} />
            {sub.description && (
              <DetailRow label="Description" value={sub.description} />
            )}
            {sub.notes && <DetailRow label="Notes" value={sub.notes} />}
          </CardContent>
        </Card>
      </div>

      {sub.status !== "cancelled" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            {sub.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange("pending_cancellation")}
              >
                Mark Pending Cancellation
              </Button>
            )}
            {sub.status === "pending_cancellation" && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleStatusChange("cancelled")}
                >
                  Confirm Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStatusChange("active")}
                >
                  Reactivate
                </Button>
              </>
            )}
            {sub.status === "trial" && (
              <Button
                variant="default"
                size="sm"
                onClick={() => handleStatusChange("active")}
              >
                Convert to Active
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
