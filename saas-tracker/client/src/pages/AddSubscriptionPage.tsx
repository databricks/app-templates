import { useNavigate } from "react-router";
import { SubscriptionForm } from "../components/SubscriptionForm";

export function AddSubscriptionPage() {
  const navigate = useNavigate();

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Add Subscription</h2>
      <SubscriptionForm
        submitLabel="Add Subscription"
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
          const res = await fetch("/api/subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: res.statusText }));
            throw new Error(err.error ?? "Failed to create subscription");
          }
          navigate("/");
        }}
      />
    </div>
  );
}
