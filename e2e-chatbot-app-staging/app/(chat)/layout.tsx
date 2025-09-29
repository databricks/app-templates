import { cookies, headers } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getAuthSessionFromHeaders } from '@/databricks/auth/databricks-auth';
import Script from 'next/script';
import { DataStreamProvider } from '@/components/data-stream-provider';

// export const experimental_ppr = true;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, headersList] = await Promise.all([cookies(), headers()]);
  const session = await getAuthSessionFromHeaders(headersList);
  const isCollapsed = cookieStore.get('sidebar:state')?.value !== 'true';
  const preferredUsername = headersList.get('x-forwarded-preferred-username');

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="beforeInteractive"
      />
      <DataStreamProvider>
        <SidebarProvider defaultOpen={!isCollapsed}>
          <AppSidebar
            user={session?.user}
            preferredUsername={preferredUsername}
          />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </DataStreamProvider>
    </>
  );
}
