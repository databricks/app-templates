export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        No score
      </span>
    );
  }

  const color =
    score >= 80
      ? "text-success"
      : score >= 50
        ? "text-warning"
        : "text-destructive";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-mono font-medium ${color}`}
    >
      {score}
      <span className="text-xs text-muted-foreground font-normal">/ 100</span>
    </span>
  );
}
