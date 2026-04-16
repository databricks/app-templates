import { useSidebar } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { Button } from './ui/button';
import { DbIcon } from '@/components/ui/db-icon';
import { SidebarCollapseIcon, SidebarExpandIcon } from '@/components/icons';

export function SidebarToggle({ forceOpenIcon }: {
  forceOpenIcon?: boolean;
}) {
  const { toggleSidebar, open } = useSidebar();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid="sidebar-toggle-button"
          onClick={toggleSidebar}
          variant="outline"
          className="h-8 px-2 md:h-fit md:px-2"
        >
          <DbIcon
            icon={!forceOpenIcon && open ? SidebarCollapseIcon : SidebarExpandIcon}
            size={16}
            color="muted"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="start" className="hidden md:block">
        Toggle Sidebar
      </TooltipContent>
    </Tooltip>
  );
}
