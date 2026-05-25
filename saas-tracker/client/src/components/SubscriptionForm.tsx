import { useState } from "react";
import { Input, Button } from "@databricks/appkit-ui/react";

const CATEGORIES = [
  "Engineering",
  "Design",
  "Marketing",
  "Sales",
  "HR",
  "Security",
  "Finance",
  "Operations",
  "Other",
] as const;

const BILLING_CYCLES = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One-time" },
] as const;

interface SubscriptionFormData {
  name: string;
  vendor: string;
  description: string;
  category: string;
  cost_cents: number;
  billing_cycle: string;
  owner_name: string;
  owner_email: string;
  department: string;
  license_count: string;
  status: string;
  start_date: string;
  renewal_date: string;
  url: string;
  notes: string;
}

interface SubscriptionFormProps {
  initialData?: Partial<SubscriptionFormData>;
  onSubmit: (data: SubscriptionFormData) => Promise<void>;
  submitLabel: string;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export function SubscriptionForm({
  initialData,
  onSubmit,
  submitLabel,
}: SubscriptionFormProps) {
  const [form, setForm] = useState<SubscriptionFormData>({
    name: initialData?.name ?? "",
    vendor: initialData?.vendor ?? "",
    description: initialData?.description ?? "",
    category: initialData?.category ?? "Engineering",
    cost_cents: initialData?.cost_cents ?? 0,
    billing_cycle: initialData?.billing_cycle ?? "monthly",
    owner_name: initialData?.owner_name ?? "",
    owner_email: initialData?.owner_email ?? "",
    department: initialData?.department ?? "",
    license_count: initialData?.license_count ?? "",
    status: initialData?.status ?? "active",
    start_date: initialData?.start_date ?? todayStr(),
    renewal_date: initialData?.renewal_date ?? "",
    url: initialData?.url ?? "",
    notes: initialData?.notes ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof SubscriptionFormData, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Subscription
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name *
            </label>
            <Input
              id="name"
              placeholder="e.g. Figma"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vendor" className="text-sm font-medium">
              Vendor *
            </label>
            <Input
              id="vendor"
              placeholder="e.g. Figma, Inc."
              value={form.vendor}
              onChange={(e) => update("vendor", e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <Input
            id="description"
            placeholder="What is this subscription for?"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="category" className="text-sm font-medium">
              Category *
            </label>
            <select
              id="category"
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cost" className="text-sm font-medium">
              Cost (USD) *
            </label>
            <Input
              id="cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="49.99"
              value={form.cost_cents ? (form.cost_cents / 100).toFixed(2) : ""}
              onChange={(e) =>
                update(
                  "cost_cents",
                  Math.round(parseFloat(e.target.value || "0") * 100),
                )
              }
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="billing_cycle" className="text-sm font-medium">
              Billing Cycle *
            </label>
            <select
              id="billing_cycle"
              value={form.billing_cycle}
              onChange={(e) => update("billing_cycle", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              {BILLING_CYCLES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Owner
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="owner_name" className="text-sm font-medium">
              Owner Name *
            </label>
            <Input
              id="owner_name"
              placeholder="Jane Smith"
              value={form.owner_name}
              onChange={(e) => update("owner_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="owner_email" className="text-sm font-medium">
              Owner Email *
            </label>
            <Input
              id="owner_email"
              type="email"
              placeholder="jane@company.com"
              value={form.owner_email}
              onChange={(e) => update("owner_email", e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="department" className="text-sm font-medium">
              Department
            </label>
            <Input
              id="department"
              placeholder="e.g. Platform Team"
              value={form.department}
              onChange={(e) => update("department", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="license_count" className="text-sm font-medium">
              License Count
            </label>
            <Input
              id="license_count"
              type="number"
              min="1"
              placeholder="e.g. 25"
              value={form.license_count}
              onChange={(e) => update("license_count", e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Dates & Status
        </legend>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="start_date" className="text-sm font-medium">
              Start Date *
            </label>
            <Input
              id="start_date"
              type="date"
              value={form.start_date}
              onChange={(e) => update("start_date", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="renewal_date" className="text-sm font-medium">
              Renewal Date
            </label>
            <Input
              id="renewal_date"
              type="date"
              value={form.renewal_date}
              onChange={(e) => update("renewal_date", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="status"
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="pending_cancellation">Pending Cancellation</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Optional
        </legend>
        <div className="space-y-1.5">
          <label htmlFor="url" className="text-sm font-medium">
            Admin URL
          </label>
          <Input
            id="url"
            type="url"
            placeholder="https://admin.figma.com"
            value={form.url}
            onChange={(e) => update("url", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes
          </label>
          <Input
            id="notes"
            placeholder="Any additional context..."
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
