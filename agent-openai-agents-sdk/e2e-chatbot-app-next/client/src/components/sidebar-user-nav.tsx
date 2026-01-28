import { ChevronUp, LoaderIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useSession } from '@/contexts/SessionContext';
import { getAiGradientStyle } from './animation-assistant-icon';
import type { ClientSession } from '@chat-template/auth';

export function SidebarUserNav({
  user,
  preferredUsername,
}: {
  user: ClientSession['user'];
  preferredUsername: string | null;
}) {
  const { session, loading } = useSession();
  const data = session;
  const status = loading
    ? 'loading'
    : session
      ? 'authenticated'
      : 'unauthenticated';
  const { setTheme, resolvedTheme } = useTheme();

  // Use preferred username from Databricks Apps if available, otherwise fall back to existing logic
  const displayName =
    preferredUsername || data?.user?.name || user?.email || 'User';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {status === 'loading' ? (
              <SidebarMenuButton className="h-10 justify-between bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                <div className="flex flex-row gap-2">
                  <div className="size-6 animate-pulse rounded-full bg-zinc-500/30" />
                  <span className="animate-pulse rounded-md bg-zinc-500/30 text-transparent">
                    Loading auth status
                  </span>
                </div>
                <div className="animate-spin text-zinc-500">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                data-testid="user-nav-button"
                className="h-10 bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div
                  style={{ ...getAiGradientStyle().styling }}
                  className="flex size-6 items-center justify-center rounded-full"
                >
                  {displayName.charAt(0)}
                </div>
                <span data-testid="user-email" className="truncate">
                  {displayName}
                </span>
                <ChevronUp className="ml-auto" />
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="user-nav-menu"
            side="top"
            className="w-(--radix-popper-anchor-width)"
          >
            <DropdownMenuItem
              data-testid="user-nav-item-theme"
              className="cursor-pointer"
              onSelect={() =>
                setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
              }
            >
              {`Toggle ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
