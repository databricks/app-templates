import { isRecord, nonEmptyString } from './values.ts';

export interface GuardrailDiagnostic {
  nodeId?: string;
  operatorName: string;
  checkIndex: number;
  checkType?: string;
  severity: 'warning' | 'failure';
  message: string;
}

export interface RunDiagnostics {
  diagnostics?: GuardrailDiagnostic[];
  failureReason?: string;
}

export function parseRunDiagnostics(raw: { diagnostics?: unknown; failureReason?: unknown }): RunDiagnostics {
  const diagnostics = Array.isArray(raw.diagnostics)
    ? raw.diagnostics.flatMap((entry): GuardrailDiagnostic[] => {
        if (!isRecord(entry)) return [];
        const operatorName = nonEmptyString(entry.operatorName);
        const message = nonEmptyString(entry.message);
        const nodeId = nonEmptyString(entry.nodeId);
        const checkType = nonEmptyString(entry.checkType);
        if (
          !operatorName ||
          !message ||
          typeof entry.checkIndex !== 'number' ||
          !Number.isSafeInteger(entry.checkIndex) ||
          entry.checkIndex < 0 ||
          (entry.severity !== 'warning' && entry.severity !== 'failure')
        )
          return [];
        return [
          {
            operatorName,
            checkIndex: entry.checkIndex,
            severity: entry.severity,
            message,
            ...(nodeId ? { nodeId } : {}),
            ...(checkType ? { checkType } : {}),
          },
        ];
      })
    : [];
  const failureReason = nonEmptyString(raw.failureReason);
  return {
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}
