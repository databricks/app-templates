import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
} from "@databricks/appkit-ui/react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { CONTENT_TARGETS, targetLabel } from "../lib/utils";

interface Guideline {
  id: string;
  target: string;
  title: string;
  description: string | null;
  rules: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function GuidelineEditor({
  guideline,
  onSave,
  onCancel,
}: {
  guideline?: Guideline;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = guideline
      ? {
          title: form.get("title") as string,
          description: (form.get("description") as string) || undefined,
          rules: form.get("rules") as string,
          updated_by: form.get("email") as string,
        }
      : {
          target: form.get("target") as string,
          title: form.get("title") as string,
          description: (form.get("description") as string) || undefined,
          rules: form.get("rules") as string,
          created_by: form.get("email") as string,
        };

    try {
      const url = guideline
        ? `/api/guidelines/${guideline.id}`
        : "/api/guidelines";
      const res = await fetch(url, {
        method: guideline ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {guideline ? `Edit: ${guideline.title}` : "New Guideline"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!guideline && (
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
          )}

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Title</label>
            <Input
              name="title"
              required
              defaultValue={guideline?.title}
              placeholder="e.g. Brand Voice Guidelines"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Description (optional)
            </label>
            <Input
              name="description"
              defaultValue={guideline?.description ?? ""}
              placeholder="Brief description of what this guideline covers"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Rules (sent to AI for scoring)
            </label>
            <textarea
              name="rules"
              required
              rows={8}
              defaultValue={guideline?.rules}
              placeholder="Write the specific rules and criteria the AI should check content against..."
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Your Email</label>
            <Input
              name="email"
              type="email"
              required
              defaultValue={guideline?.updated_by}
              placeholder="moderator@company.com"
            />
          </div>

          {error && (
            <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving} size="sm">
              {saving ? (
                "Saving..."
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  {guideline ? "Update" : "Create"}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function GuidelinesPage() {
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetFilter, setTargetFilter] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function fetchGuidelines() {
    fetch("/api/guidelines")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<Guideline[]>;
      })
      .then(setGuidelines)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchGuidelines();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this guideline?")) return;
    await fetch(`/api/guidelines/${id}`, { method: "DELETE" });
    fetchGuidelines();
  }

  async function handleToggleActive(g: Guideline) {
    await fetch(`/api/guidelines/${g.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_active: !g.is_active,
        updated_by: g.updated_by,
      }),
    });
    fetchGuidelines();
  }

  const filtered =
    targetFilter === "all"
      ? guidelines
      : guidelines.filter((g) => g.target === targetFilter);

  const grouped = filtered.reduce<Record<string, Guideline[]>>((acc, g) => {
    if (!acc[g.target]) acc[g.target] = [];
    acc[g.target].push(g);
    return acc;
  }, {});

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Guidelines</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage content guidelines per target. Active guidelines are used by
            the AI for compliance scoring.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="all">All targets</option>
            {CONTENT_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Guideline
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {creating && (
        <GuidelineEditor
          onSave={() => {
            setCreating(false);
            fetchGuidelines();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={`skel-${i}`}
              className="h-24 w-full rounded-lg bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && Object.keys(grouped).length === 0 && !creating && (
        <p className="text-muted-foreground text-center py-16">
          No guidelines yet. Create your first guideline to start scoring
          content.
        </p>
      )}

      {!loading &&
        Object.entries(grouped).map(([target, items]) => (
          <section key={target} className="space-y-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
              {targetLabel(target)} ({items.length})
            </h3>

            {items.map((g) =>
              editing === g.id ? (
                <GuidelineEditor
                  key={g.id}
                  guideline={g}
                  onSave={() => {
                    setEditing(null);
                    fetchGuidelines();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <Card key={g.id} className={!g.is_active ? "opacity-50" : ""}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{g.title}</span>
                          {!g.is_active && (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </div>
                        {g.description && (
                          <p className="text-sm text-muted-foreground">
                            {g.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {g.rules}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(g)}
                          title={g.is_active ? "Deactivate" : "Activate"}
                        >
                          {g.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(g.id);
                            setCreating(false);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(g.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ),
            )}
          </section>
        ))}
    </div>
  );
}
