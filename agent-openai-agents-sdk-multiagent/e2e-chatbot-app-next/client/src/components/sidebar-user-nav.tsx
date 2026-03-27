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
  useSidebar,
} from '@/components/ui/sidebar';
import { useSession } from '@/contexts/SessionContext';
import { getAiGradientStyle } from './animation-assistant-icon';
import type { ClientSession } from '@chat-template/auth';
import { cn } from '../lib/utils';

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
  const { open } = useSidebar();

  // Use preferred username from Databricks Apps if available, otherwise fall back to existing logic
  const displayName =
    preferredUsername || data?.user?.name || user?.email || 'User';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className={cn("flex items-center justify-center flex-col",
              { "h-10": open, 'h-8': !open },
            )}>
              {status === 'loading' ? (
                <SidebarMenuButton className="flex-1 justify-between bg-sidebar data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
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
                  className="flex-1 bg-sidebar data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
                  tooltip={!open ? displayName : undefined}
                >
                  <div
                    style={{ ...getAiGradientStyle().styling }}
                    className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", {
                      "-ml-1": !open
                    })}
                  >
                    {displayName.charAt(0)}
                  </div>
                  {open && (
                    <>
                      <span data-testid="user-email" className="truncate">
                        {displayName}
                      </span>
                      <ChevronUp className="ml-auto" />
                    </>
                  )}
                </SidebarMenuButton>
              )}
            </div>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu >
  );
}
