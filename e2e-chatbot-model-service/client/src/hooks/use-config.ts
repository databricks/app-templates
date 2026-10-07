import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * @deprecated Use useAppConfig() directly from AppConfigContext instead.
 * This hook is kept for backwards compatibility and re-exports from the context.
 */
export function useConfig() {
  return useAppConfig();
}
