import type * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";

export function ThreadListSidebar({
  children,
  headerAction,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  headerAction?: React.ReactNode;
}) {
  return (
    <Sidebar {...props}>
      <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader className="aui-sidebar-header flex-row items-center justify-between border-b px-4 py-3">
          <h2 className="aui-sidebar-header-title text-sm font-semibold">
            Conversations
          </h2>
          {headerAction}
        </SidebarHeader>
        <SidebarContent className="aui-sidebar-content px-2">
          <ThreadList />
          {children}
        </SidebarContent>
      </nav>
      {props.collapsible !== "none" && <SidebarRail />}
    </Sidebar>
  );
}
