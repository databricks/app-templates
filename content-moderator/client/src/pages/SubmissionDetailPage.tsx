import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
  Separator,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@databricks/appkit-ui/react";
import { ArrowLeft, RotateCcw, Send } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { TargetBadge } from "../components/TargetBadge";
import { ScoreBadge } from "../components/ScoreBadge";
import { formatDate } from "../lib/utils";

interface Submission {
  id: string;
  title: string;
  body: string;
  target: string;
  author_name: string;
  author_email: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Analysis {
  id: string;
  compliance_score: number;
  issues: string;
  suggestions: string;
  model: string;
  analyzed_at: string;
}

interface Review {
  id: string;
  reviewer_name: string;
  reviewer_email: string;
  decision: string;
  feedback: string | null;
  created_at: string;
}

interface Guideline {
  id: string;
  title: string;
  rules: string;
}

interface DetailResponse {
  submission: Submission;
  analyses: Analysis[];
  reviews: Review[];
  guidelines: Guideline[];
}

function parseIssues(issuesStr: string | null): string[] {
  if (!issuesStr) return [];
  try {
    const parsed: unknown = JSON.parse(issuesStr);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* not JSON */
  }
  return issuesStr ? [issuesStr] : [];
}

export function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftDecision, setDraftDecision] = useState("approved");
  const [draftFeedback, setDraftFeedback] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const refetch = useCallback(() => {
    if (!id) return;
    fetch(`/api/submissions/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<DetailResponse>;
      })
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [id]);

  useEffect(() => {
    refetch();
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, [refetch]);

  useEffect(() => {
    if (!id || loading) return;
    const interval = setInterval(refetch, 8000);
    return () => clearInterval(interval);
  }, [id, loading, refetch]);

  async function handleReview() {
    if (!id || !reviewerName.trim() || !reviewerEmail.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/submissions/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer_name: reviewerName,
          reviewer_email: reviewerEmail,
          decision: draftDecision,
          feedback: draftFeedback || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      refetch();
      setDraftFeedback("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReanalyze() {
    if (!id) return;
    setReanalyzing(true);
    try {
      await fetch(`/api/submissions/${id}/reanalyze`, { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      setReanalyzing(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3">
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
          <div className="col-span-2">
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="w-full max-w-6xl mx-auto px-6 py-8">
        <div className="text-destructive bg-destructive/10 p-4 rounded-md">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { submission, analyses, reviews, guidelines } = data;
  const latestAnalysis = analyses[0] ?? null;
  const issues = latestAnalysis ? parseIssues(latestAnalysis.issues) : [];

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
        <Separator orientation="vertical" className="h-4" />
        <h2 className="text-lg font-semibold">{submission.title}</h2>
        <StatusBadge status={submission.status} />
        <TargetBadge target={submission.target} />
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Left column: content + review form */}
        <div className="col-span-3 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Content</CardTitle>
                <span className="text-xs text-muted-foreground">
                  by {submission.author_name} &middot;{" "}
                  {formatDate(submission.created_at)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {submission.body}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Review form */}
          {submission.status !== "approved" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Submit Review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Reviewer Name
                    </label>
                    <input
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="Your name"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Reviewer Email
                    </label>
                    <input
                      value={reviewerEmail}
                      onChange={(e) => setReviewerEmail(e.target.value)}
                      type="email"
                      placeholder="you@company.com"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">
                    Decision
                  </label>
                  <Select
                    value={draftDecision}
                    onValueChange={setDraftDecision}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">Approve</SelectItem>
                      <SelectItem value="rejected">Reject</SelectItem>
                      <SelectItem value="revision_requested">
                        Request Revision
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">
                    Feedback (optional)
                  </label>
                  <textarea
                    value={draftFeedback}
                    onChange={(e) => setDraftFeedback(e.target.value)}
                    rows={4}
                    placeholder="Explain your decision..."
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <Button
                  onClick={handleReview}
                  disabled={
                    submitting || !reviewerName.trim() || !reviewerEmail.trim()
                  }
                  className="w-full"
                >
                  {submitting ? (
                    "Submitting..."
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Submit Review
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Review history */}
          {reviews.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Review History ({reviews.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className="border border-border/40 rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {r.reviewer_name}
                        </span>
                        <StatusBadge status={r.decision} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.created_at)}
                      </span>
                    </div>
                    {r.feedback && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {r.feedback}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: AI analysis + guidelines */}
        <div className="col-span-2 space-y-4">
          {latestAnalysis ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">AI Analysis</CardTitle>
                    <div className="flex items-center gap-2">
                      <ScoreBadge score={latestAnalysis.compliance_score} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReanalyze}
                        disabled={reanalyzing}
                        title="Re-analyze with current guidelines"
                      >
                        <RotateCcw
                          className={`h-3.5 w-3.5 ${reanalyzing ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">
                    {latestAnalysis.model}
                  </span>
                </CardHeader>
                <CardContent className="space-y-4">
                  {issues.length > 0 && (
                    <div>
                      <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                        Issues Found
                      </h4>
                      <ul className="space-y-1.5">
                        {issues.map((issue, i) => (
                          <li
                            key={`issue-${i}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            <span className="text-destructive mt-0.5 shrink-0">
                              *
                            </span>
                            {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {latestAnalysis.suggestions && (
                    <div>
                      <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                        Suggestions
                      </h4>
                      <p className="text-sm leading-relaxed">
                        {latestAnalysis.suggestions}
                      </p>
                    </div>
                  )}

                  {issues.length === 0 && !latestAnalysis.suggestions && (
                    <p className="text-sm text-success">
                      Content looks compliant with all guidelines.
                    </p>
                  )}
                </CardContent>
              </Card>

              {analyses.length > 1 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Past Analyses ({analyses.length - 1})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analyses.slice(1).map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between border border-border/40 rounded-lg p-3"
                      >
                        <ScoreBadge score={a.compliance_score} />
                        <span className="text-xs text-muted-foreground">
                          {formatDate(a.analyzed_at)}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No AI analysis available.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure a serving endpoint to enable AI-powered content
                  scoring.
                </p>
              </CardContent>
            </Card>
          )}

          {guidelines.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Active Guidelines for {submission.target}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {guidelines.map((g) => (
                  <div
                    key={g.id}
                    className="border border-border/40 rounded-lg p-3"
                  >
                    <p className="text-sm font-medium mb-1">{g.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                      {g.rules}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Submission Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Author</span>
                <span>{submission.author_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{submission.author_email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Submitted</span>
                <span>{formatDate(submission.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last updated</span>
                <span>{formatDate(submission.updated_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
