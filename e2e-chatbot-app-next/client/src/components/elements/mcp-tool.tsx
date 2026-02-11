import { Button } from '@/components/ui/button';
import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  ChevronDownIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
} from 'lucide-react';
import {
  ToolContainer,
  ToolContent,
  ToolInput,
  ToolOutput,
  ToolStatusBadge,
  type ToolState,
} from './tool';

// MCP-specific container with distinct styling
type McpToolProps = Parameters<typeof ToolContainer>[0];

export const McpTool = ({ className, ...props }: McpToolProps) => (
  <ToolContainer
    className={cn('overflow-hidden rounded-lg bg-muted/30', className)}
    {...props}
  />
);

// Re-export shared components for convenience
export {
  ToolContent as McpToolContent,
  ToolInput as McpToolInput,
  ToolOutput as McpToolOutput,
};

// MCP-specific header with banner
type McpToolHeaderProps = {
  serverName?: string;
  toolName: string;
  state: ToolState;
  // Used when state is 'approval-responded' to determine approval outcome
  approved?: boolean;
  className?: string;
};

// Badge component for approval status in the banner
// Uses AI SDK native tool states directly
type ApprovalStatusBadgeProps = {
  state: ToolState;
  // Used when state is 'approval-responded' to determine approval outcome
  approved?: boolean;
};

const ApprovalStatusBadge = ({ state, approved }: ApprovalStatusBadgeProps) => {
  // Pending: waiting for user approval
  if (state === 'approval-requested') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
        data-testid="mcp-approval-status-pending"
      >
        <ShieldAlertIcon className="size-3" />
        <span>Pending</span>
      </span>
    );
  }

  // Allowed: tool executed successfully or user approved (waiting for execution)
  if (
    state === 'output-available' ||
    (state === 'approval-responded' && approved === true)
  ) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/50 dark:text-green-300"
        data-testid="mcp-approval-status-allowed"
      >
        <ShieldCheckIcon className="size-3" />
        <span>Allowed</span>
      </span>
    );
  }

  // Denied: user explicitly denied the tool
  if (
    state === 'output-denied' ||
    (state === 'approval-responded' && approved === false)
  ) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/50 dark:text-red-300"
        data-testid="mcp-approval-status-denied"
      >
        <ShieldXIcon className="size-3" />
        <span>Denied</span>
      </span>
    );
  }

  // Fallback for any other state - show as pending
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
      data-testid="mcp-approval-status-pending"
    >
      <ShieldAlertIcon className="size-3" />
      <span>Pending</span>
    </span>
  );
};

export const McpToolHeader = ({
  className,
  serverName,
  toolName,
  state,
  approved,
}: McpToolHeaderProps) => (
  <div className="border-border border-b bg-muted/50">
    {/* MCP Banner */}
    <div className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-xs">
      <ServerIcon className="size-3 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">
        Tool Call Request
      </span>
      {serverName && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <span className="truncate text-muted-foreground">{serverName}</span>
        </>
      )}
      <span className="text-muted-foreground/50">•</span>
      <ApprovalStatusBadge state={state} approved={approved} />
    </div>
    {/* Tool header */}
    <CollapsibleTrigger
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-mono text-sm">{toolName}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Only show tool status badge when tool is running/completed (approved) */}
        {(state === 'output-available' ||
          (state === 'approval-responded' && approved === true)) && (
          <ToolStatusBadge state={state} />
        )}
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </div>
    </CollapsibleTrigger>
  </div>
);

// MCP-specific approval actions
type McpApprovalActionsProps = {
  onApprove: () => void;
  onDeny: () => void;
  isSubmitting: boolean;
};

export const McpApprovalActions = ({
  onApprove,
  onDeny,
  isSubmitting,
}: McpApprovalActionsProps) => (
  <div
    className="flex flex-col gap-3 border-amber-300 border-t bg-amber-50/50 p-3 dark:border-amber-700 dark:bg-amber-950/20"
    data-testid="mcp-approval-actions"
  >
    <div className="flex items-start gap-2">
      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-amber-800 text-sm dark:text-amber-200">
        This tool requires your permission to run.
      </p>
    </div>
    <div className="flex gap-2">
      <Button
        variant="default"
        size="sm"
        onClick={onApprove}
        disabled={isSubmitting}
        className="bg-green-600 hover:bg-green-700"
        data-testid="mcp-approval-allow"
      >
        <ShieldCheckIcon className="mr-1.5 size-4" />
        {isSubmitting ? 'Submitting...' : 'Allow'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDeny}
        disabled={isSubmitting}
        data-testid="mcp-approval-deny"
      >
        <ShieldXIcon className="mr-1.5 size-4" />
        Deny
      </Button>
    </div>
  </div>
);

// MCP-specific approval status display
type McpApprovalStatusProps = {
  approved: boolean;
  reason?: string;
};

export const McpApprovalStatus = ({
  approved,
  reason,
}: McpApprovalStatusProps) => (
  <div
    className={cn(
      'flex items-center gap-2 border-t p-3',
      approved
        ? 'border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20'
        : 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20',
    )}
  >
    {approved ? (
      <ShieldCheckIcon className="size-4 text-green-600 dark:text-green-400" />
    ) : (
      <ShieldXIcon className="size-4 text-red-600 dark:text-red-400" />
    )}
    <span
      className={cn(
        'text-sm',
        approved
          ? 'text-green-700 dark:text-green-300'
          : 'text-red-700 dark:text-red-300',
      )}
    >
      {approved ? 'Allowed' : 'Denied'}
    </span>
    {reason && (
      <>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground text-sm">{reason}</span>
      </>
    )}
  </div>
);
