import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DbIcon } from '@/components/ui/db-icon';
import { NewChatIcon, SidebarCollapseIcon, SidebarExpandIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { ClientSession } from '@chat-template/auth';
import { Button } from './ui/button';
import { Action } from './elements/actions';

export function AppSidebar({
  user,
  preferredUsername,
}: {
  user: ClientSession['user'] | undefined;
  preferredUsername: string | null;
}) {
  const navigate = useNavigate();
  const { setOpenMobile, open, toggleSidebar } = useSidebar();

  return (
    <Sidebar
      collapsible="icon"
      className="group-data-[side=left]:border-r-0"
    >
      {/* ── Header: app title + collapse toggle ────────────────────────── */}
      <SidebarHeader
        className={cn(
          'h-[44px] flex-row items-center gap-2 px-2 py-0',
          open ? 'justify-between' : 'justify-center',
        )}
      >
        {open && (
          <Link
            to="/"
            onClick={() => setOpenMobile(false)}
            className="flex items-center overflow-hidden px-1"
          >
            <span className="text-base font-semibold text-foreground">
              Chatbot
            </span>
          </Link>
        )}

        <Action
          onClick={toggleSidebar}
          tooltip={open ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <DbIcon
            icon={open ? SidebarCollapseIcon : SidebarExpandIcon}
            size={16}
            color="muted"
          />
        </Action>
      </SidebarHeader>

      {/* ── Nav: New Chat item ───────────────────────────────────────────── */}
      <div className="px-2 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  type="button"
                  className="h-8 p-1 md:p-2 cursor-pointer"
                  onClick={() => {
                    setOpenMobile(false);
                    navigate('/');
                  }}
                >
                  <DbIcon icon={NewChatIcon} size={16} color="default" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    New chat
                  </span>
                </SidebarMenuButton>
              </TooltipTrigger>
              {!open && (
                <TooltipContent side="right">New chat</TooltipContent>
              )}
            </Tooltip>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>

      {/* ── Chat history ────────────────────────────────────────────────── */}
      <SidebarContent>
        {open && <SidebarHistory user={user} />}
      </SidebarContent>

      {/* ── User nav ────────────────────────────────────────────────────── */}
      <SidebarFooter>
        {user && (
          <SidebarUserNav user={user} preferredUsername={preferredUsername} />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
