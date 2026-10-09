
// AppKit serves SPA HTML outside /api, so every JSON route must remain under this prefix.
export const CONFIG_ROUTE = '/api/designer/config';
export const RUN_ROUTE = '/api/designer/run';

export const LAST_RUN_ROUTE = '/api/designer/last-run';

export const RUN_HISTORY_ROUTE = '/api/designer/runs';

export const uploadsRoute = (parameterName: string): string =>
  `/api/designer/uploads/${encodeURIComponent(parameterName)}`;

export const uploadDownloadRoute = (parameterName: string, reference: string): string =>
  `${uploadsRoute(parameterName)}/${encodeURIComponent(reference)}/download`;

export const runStatusRoute = (jobRunId: string): string => `${RUN_ROUTE}/${jobRunId}`;

export const runHistoryRoute = (windowSize: number): string => `${RUN_HISTORY_ROUTE}?window=${windowSize}`;
