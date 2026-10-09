import { Alert, AlertDescription, AlertTitle, Button } from '@databricks/appkit-ui/react';
import type { ErrorPayload } from './payload';

export function EmptyResult() {
  return (
    <div className="border-border border-t px-6 py-12 text-center">
      <p className="text-sm font-medium">No rows returned</p>
      <p className="text-muted-foreground mt-1 text-sm">This operator produced no rows.</p>
    </div>
  );
}

export function ComputeError({ payload, onRetry }: { payload: ErrorPayload; onRetry: () => void }) {
  return (
    <div className="border-border border-t p-6">
      <Alert variant="destructive">
        <AlertTitle>{payload.error.type}</AlertTitle>
        <AlertDescription>
          <p className="whitespace-pre-wrap break-words">{payload.error.message}</p>
        </AlertDescription>
      </Alert>

      {payload.error.traceback_tail ? (
        <details className="mt-4">
          <summary className="text-muted-foreground cursor-pointer text-xs select-none">Traceback</summary>
          <pre className="bg-muted text-muted-foreground mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {payload.error.traceback_tail}
          </pre>
        </details>
      ) : null}

      <div className="text-muted-foreground mt-4 flex items-center gap-3 text-xs">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Run again
        </Button>
        <span>
          The operator <span className="font-mono">{payload.target_node}</span> failed. The job run itself succeeded, so
          this is a computation error rather than an infrastructure one.
        </span>
      </div>
    </div>
  );
}

export function MissingOutput({ reason }: { reason: string }) {
  return (
    <div className="border-border border-t p-6">
      <Alert>
        <AlertTitle>This output was not returned</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
    </div>
  );
}

export function MalformedOutput({ reason }: { reason: string }) {
  return (
    <div className="border-border border-t p-6">
      <Alert variant="destructive">
        <AlertTitle>This output could not be read</AlertTitle>
        <AlertDescription>
          <p>{reason}</p>
          <p className="mt-2">
            The rest of the run is unaffected. This is not an empty result: nothing can be said about how many rows this
            output would have produced.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function NoPayload({ reason, runPageUrl }: { reason: string; runPageUrl?: string }) {
  return (
    <div className="border-border border-t p-6">
      <Alert variant="destructive">
        <AlertTitle>The job produced no result</AlertTitle>
        <AlertDescription>
          <p>{reason}</p>
          <p className="mt-2">
            This is not an empty result. The run did not return a readable payload at all, so nothing can be said about
            how many rows the operator would have produced.
          </p>
        </AlertDescription>
      </Alert>
      {runPageUrl ? (
        <a
          className="text-muted-foreground mt-4 inline-block text-xs underline underline-offset-2"
          href={runPageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the run in Jobs
        </a>
      ) : null}
    </div>
  );
}
