import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useSession } from '@/contexts/SessionContext';

export default function ChatLayout() {
  const { session, loading } = useSession();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar:state');
    return saved !== 'true';
  });

  useEffect(() => {
    // Load Pyodide script for any Python execution features
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js';
    script.async = true;
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  // Wait for session to load
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No guest mode - redirect if no session
  if (!session?.user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
          <p className="text-muted-foreground">
            Please authenticate using Databricks to access this application.
          </p>
        </div>
      </div>
    );
  }

  // Get preferred username from session (if available from headers)
  const preferredUsername = session.user.preferredUsername ?? null;

  return (
    <SidebarProvider
      defaultOpen={!isCollapsed}
      onOpenChange={(open) => {
        localStorage.setItem('sidebar:state', String(open));
        setIsCollapsed(!open);
      }}
    >
      <AppSidebar user={session.user} preferredUsername={preferredUsername} />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
