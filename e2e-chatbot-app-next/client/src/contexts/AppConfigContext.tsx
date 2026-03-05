import { createContext, useContext, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/utils';

interface ConfigResponse {
  features: {
    chatHistory: boolean;
    feedback: boolean;
  };
  obo?: {
    enabled: boolean;
    requiredScopes: string[];
  };
}

interface AppConfigContextType {
  config: ConfigResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
  chatHistoryEnabled: boolean;
  feedbackEnabled: boolean;
  oboEnabled: boolean;
  oboRequiredScopes: string[];
}

const AppConfigContext = createContext<AppConfigContextType | undefined>(
  undefined,
);

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading } = useSWR<ConfigResponse>(
    '/api/config',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Config should be loaded once and cached
      dedupingInterval: 60000, // 1 minute
    },
  );

  const value: AppConfigContextType = {
    config: data,
    isLoading,
    error,
    // Default to true until loaded to avoid breaking existing behavior
    chatHistoryEnabled: data?.features.chatHistory ?? true,
    feedbackEnabled: data?.features.feedback ?? false,
    oboEnabled: data?.obo?.enabled ?? false,
    oboRequiredScopes: data?.obo?.requiredScopes ?? [],
  };

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context;
}
