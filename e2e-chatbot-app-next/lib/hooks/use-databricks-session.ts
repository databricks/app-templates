'use client';

import { useEffect, useState } from 'react';
import type { ClientSession } from '@/databricks/auth/databricks-auth';

export function useDatabricksSession() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSession() {
      try {
        const response = await fetch('/api/session');
        if (response.ok) {
          const data = await response.json();
          setSession(data);
        }
      } catch (error) {
        console.error('Failed to fetch session:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, []);

  return {
    data: session,
    status: loading
      ? 'loading'
      : session?.user
        ? 'authenticated'
        : 'unauthenticated',
  };
}
