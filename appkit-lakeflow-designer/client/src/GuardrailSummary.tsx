import type { GuardrailDiagnostic } from '../../server/plugins/designer/client';
import { Alert, AlertDescription, AlertTitle, Badge } from '@databricks/appkit-ui/react';

export interface GuardrailSummaryProps {
  diagnostics?: GuardrailDiagnostic[];
}

export function GuardrailSummary({ diagnostics }: GuardrailSummaryProps) {
  if (!diagnostics?.length) return null;
  const failed = diagnostics.some((diagnostic) => diagnostic.severity === 'failure');
  return (
    <Alert variant={failed ? 'destructive' : 'default'}>
      <AlertTitle>Guardrails {failed ? 'failures' : 'warnings'}</AlertTitle>
      <AlertDescription>
        <ul className="grid gap-3">
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.nodeId}:${diagnostic.checkIndex}:${diagnostic.message}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{diagnostic.operatorName}</span>
                <Badge variant="outline">{diagnostic.severity === 'failure' ? 'Failure' : 'Warning'}</Badge>
                <span>{`Check ${diagnostic.checkIndex + 1}${diagnostic.checkType ? ` (${diagnostic.checkType})` : ''}`}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{diagnostic.message}</p>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
