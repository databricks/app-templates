import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
} from "@databricks/appkit-ui/react";
import { CONTENT_TARGETS } from "../lib/utils";

export function SubmitContentPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = {
      title: form.get("title") as string,
      body: form.get("body") as string,
      target: form.get("target") as string,
      author_name: form.get("author_name") as string,
      author_email: form.get("author_email") as string,
    };

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to submit",
        );
      }
      const result = (await res.json()) as { id: string };
      navigate(`/submissions/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-6 py-8 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Submit Content</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">New Submission</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Your Name
                </label>
                <Input name="author_name" required placeholder="Jane Smith" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Your Email
                </label>
                <Input
                  name="author_email"
                  type="email"
                  required
                  placeholder="jane@company.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                Content Target
              </label>
              <select
                name="target"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {CONTENT_TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Title</label>
              <Input
                name="title"
                required
                placeholder="e.g. Q2 Product Launch Announcement"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Content</label>
              <textarea
                name="body"
                required
                rows={12}
                placeholder="Write or paste your content here..."
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {error && (
              <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit for Review"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
