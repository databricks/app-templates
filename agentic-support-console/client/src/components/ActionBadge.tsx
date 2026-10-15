const ACTION_STYLES: Record<string, string> = {
  refund: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  credit: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  escalate: 'bg-red-500/15 text-red-400 border-red-500/30',
  no_action: 'bg-muted text-muted-foreground border-border/50',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ActionBadge({ action, amountCents }: { action: string; amountCents?: number | null }) {
  const style = ACTION_STYLES[action] ?? ACTION_STYLES.no_action;
  const showAmount = (action === 'refund' || action === 'credit') && typeof amountCents === 'number' && amountCents > 0;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${style}`}>
      {action.replace('_', ' ')}
      {showAmount && <span className="font-mono">{formatCents(amountCents)}</span>}
    </span>
  );
}
