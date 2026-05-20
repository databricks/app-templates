import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Skeleton,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Send, Check, ChevronDown, Loader2, Copy } from 'lucide-react';
import { ActionBadge } from '../components/ActionBadge';

interface CaseDetail {
  case_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_region: string;
  subject: string;
  status: string;
  case_created_at: string;
  message_count: number;
  has_admin_reply: boolean;
  first_response_minutes: number | null;
  linked_refund_cents: number;
  linked_credit_cents: number;
  user_lifetime_spend_cents: number;
  user_cases_90d: number;
}

interface Message {
  id: string;
  role: 'customer' | 'admin';
  content: string;
  created_at: string;
}

interface AgentResponse {
  message_id: string;
  case_summary: string;
  suggested_response: string;
  suggested_action: string;
  suggested_amount_cents: number;
  reasoning: string;
  model: string;
  generated_at: string;
}

interface UserProfile {
  total_orders_90d: number;
  total_spend_90d_cents: number;
  lifetime_order_count: number;
  lifetime_spend_cents: number;
  support_cases_90d: number;
  support_cases_lifetime: number;
  total_refunds_90d_cents: number;
  total_credits_90d_cents: number;
}

interface CaseDetailResponse {
  case: CaseDetail;
  messages: Message[];
  agentResponses: AgentResponse[];
  userProfile: UserProfile | null;
}

const CASE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function AgentHistory({ responses }: { responses: AgentResponse[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center justify-between w-full text-left">
          <CardTitle className="text-sm">Past Agent Drafts ({responses.length})</CardTitle>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {responses.map((r) => (
            <div key={r.message_id} className="border border-border/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <ActionBadge action={r.suggested_action} amountCents={r.suggested_amount_cents} />
                <span className="text-xs text-muted-foreground">
                  {new Date(r.generated_at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{r.case_summary}</p>
              <p className="text-xs italic text-muted-foreground leading-relaxed">{r.reasoning}</p>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy full ID: ${id}`}
      className="inline-flex items-center gap-1.5 font-mono text-xs bg-muted/50 px-2 py-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
    >
      {id.slice(0, 8)}
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [data, setData] = useState<CaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftResponse, setDraftResponse] = useState('');
  const [draftAction, setDraftAction] = useState('no_action');
  const [draftAmount, setDraftAmount] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [caseStatus, setCaseStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const refetch = useCallback(() => {
    if (!caseId) return;
    return fetch(`/api/cases/${caseId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch case: ${res.statusText}`);
        return res.json() as Promise<CaseDetailResponse>;
      })
      .then((d) => {
        setData(d);
        setCaseStatus(d.case.status);
        const latest = d.agentResponses[0];
        if (latest && !submitted) {
          setDraftResponse(latest.suggested_response);
          setDraftAction(latest.suggested_action);
          setDraftAmount(String(latest.suggested_amount_cents));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case'));
  }, [caseId, submitted]);

  useEffect(() => {
    refetch()?.finally(() => setLoading(false));
  }, [refetch]);

  useEffect(() => {
    if (!caseId || loading) return;
    const interval = setInterval(() => refetch(), 10_000);
    return () => clearInterval(interval);
  }, [caseId, loading, refetch]);

  async function handleSubmit() {
    if (!caseId || !draftResponse.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          admin_action: draftAction,
          admin_amount_cents: parseInt(draftAmount, 10) || 0,
          admin_response: draftResponse.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!caseId || newStatus === caseStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setCaseStatus(newStatus);
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setUpdatingStatus(false);
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={`msg-${i}`} className="h-20 w-full rounded-lg" />
            ))}
          </div>
          <div className="col-span-2">
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full max-w-6xl mx-auto px-6 py-8">
        <div className="text-destructive bg-destructive/10 p-4 rounded-md">{error ?? 'Case not found'}</div>
      </div>
    );
  }

  const { case: caseData, messages, agentResponses, userProfile } = data;
  const latestAgentResponse = agentResponses[0] ?? null;
  const olderAgentResponses = agentResponses.slice(1);
  const lastMessage = messages[messages.length - 1];
  const adminAlreadyReplied = lastMessage?.role === 'admin' && !submitted;
  const hasLinkedRefund = caseData.linked_refund_cents > 0;
  const hasLinkedCredit = caseData.linked_credit_cents > 0;
  const hasLinkedCompensation = hasLinkedRefund || hasLinkedCredit;

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
        <h2 className="text-lg font-semibold">{caseData.subject}</h2>
        <CopyableId id={caseData.case_id} />
        <Badge variant={caseStatus === 'resolved' || caseStatus === 'closed' ? 'outline' : 'secondary'}>
          {caseStatus}
        </Badge>
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Message Thread</CardTitle>
                <span className="text-xs text-muted-foreground">{messages.length} messages</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg ${
                    msg.role === 'customer'
                      ? 'bg-muted/50 border border-border/30'
                      : 'bg-foreground/5 border border-foreground/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {msg.role}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {hasLinkedCompensation && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Applied Compensation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  {hasLinkedRefund && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Refund</Badge>
                      <span className="text-sm font-mono font-medium">{formatCents(caseData.linked_refund_cents)}</span>
                    </div>
                  )}
                  {hasLinkedCredit && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Credit</Badge>
                      <span className="text-sm font-mono font-medium">{formatCents(caseData.linked_credit_cents)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {submitted ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Decision Submitted</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-success">
                  <Check className="h-4 w-4" />
                  Decision recorded successfully.
                </div>
              </CardContent>
            </Card>
          ) : adminAlreadyReplied ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Response Sent</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4" />
                  An admin response has been sent. Waiting for customer reply.
                </div>
              </CardContent>
            </Card>
          ) : latestAgentResponse ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Your Decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Action</label>
                  <Select value={draftAction} onValueChange={setDraftAction}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="refund">Refund</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                      <SelectItem value="no_action">No action</SelectItem>
                      <SelectItem value="escalate">Escalate</SelectItem>
                      <SelectItem value="resolve">Resolve</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(draftAction === 'refund' || draftAction === 'credit') && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Amount (cents)</label>
                    <Input type="number" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} min={0} />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Response to customer</label>
                  <textarea
                    value={draftResponse}
                    onChange={(e) => setDraftResponse(e.target.value)}
                    rows={5}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <Button onClick={handleSubmit} disabled={submitting || !draftResponse.trim()} className="w-full">
                  {submitting ? (
                    'Submitting...'
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Approve & Send
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Waiting for agent response...</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Case Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={caseStatus} onValueChange={handleStatusChange} disabled={updatingStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {updatingStatus && <p className="text-xs text-muted-foreground">Updating...</p>}
            </CardContent>
          </Card>

          {latestAgentResponse && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">AI Summary</CardTitle>
                    <span className="text-xs text-muted-foreground font-mono">{latestAgentResponse.model}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{latestAgentResponse.case_summary}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Agent Recommendation</CardTitle>
                    <ActionBadge
                      action={latestAgentResponse.suggested_action}
                      amountCents={latestAgentResponse.suggested_amount_cents}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs italic text-muted-foreground leading-relaxed">
                    {latestAgentResponse.reasoning}
                  </p>
                </CardContent>
              </Card>
            </>
          )}

          {olderAgentResponses.length > 0 && <AgentHistory responses={olderAgentResponses} />}

          {userProfile && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Customer Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name</span>
                    <p className="font-medium">{caseData.user_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Region</span>
                    <p className="font-medium">{caseData.user_region || 'Unknown'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Lifetime spend</span>
                    <p className="font-medium font-mono">{formatCents(userProfile.lifetime_spend_cents)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Orders (90d)</span>
                    <p className="font-medium">{userProfile.total_orders_90d}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Support cases (90d)</span>
                    <p className="font-medium">{userProfile.support_cases_90d}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Refunds (90d)</span>
                    <p className="font-medium font-mono">{formatCents(userProfile.total_refunds_90d_cents)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Credits (90d)</span>
                    <p className="font-medium font-mono">{formatCents(userProfile.total_credits_90d_cents)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
