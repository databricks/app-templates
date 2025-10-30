import type { FetchFunction } from '@ai-sdk/provider-utils';

export type DatabricksLanguageModelConfig = {
  provider: string;
  headers: () => Record<string, string | undefined>;
  url: (options: { path: string }) => string;
  fetch?: FetchFunction;
};
