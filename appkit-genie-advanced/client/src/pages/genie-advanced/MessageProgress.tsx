import { Check, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  status: string;
}

const PIPELINE = [
  { key: 'SUBMITTED', label: 'Sent to Genie' },
  { key: 'ASKING_AI', label: 'Understanding your question' },
  { key: 'EXECUTING_QUERY', label: 'Running SQL on warehouse' },
  { key: 'COMPLETED', label: 'Ready' },
] as const;

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function MessageProgress({ status }: Props) {
  if (status === 'FAILED' || status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive py-1">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>
          {status === 'CANCELLED'
            ? 'Cancelled'
            : 'Genie could not answer this question'}
        </span>
      </div>
    );
  }

  if (status === 'COMPLETED') return null;

  const steps = PIPELINE;
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === status),
  );

  return (
    <ul className="space-y-1.5 py-1" aria-live="polite">
      {steps.map((step, i) => {
        const isCurrent = i === currentIndex && !TERMINAL.has(status);
        const isPast = i < currentIndex;
        const isFuture = i > currentIndex;

        return (
          <li
            key={step.key}
            className={`flex items-center gap-2 text-xs transition-all duration-300 ${
              isPast
                ? 'text-muted-foreground line-through blur-[0.5px] opacity-50'
                : isCurrent
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground/40'
            }`}
          >
            <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0">
              {isPast && <Check className="h-3.5 w-3.5" />}
              {isCurrent && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {isFuture && (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
              )}
            </span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
