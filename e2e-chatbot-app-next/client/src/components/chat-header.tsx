import { useNavigate } from 'react-router-dom';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { MessageSquareOff, ShieldAlert } from 'lucide-react';
import { useConfig } from '@/hooks/use-config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PlusIcon, CloudOffIcon } from './icons';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

const DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app';

export function ChatHeader({ title, empty, isLoadingTitle }: { title?: string, empty?: boolean, isLoadingTitle?: boolean }) {
  const navigate = useNavigate();
  const { chatHistoryEnabled, feedbackEnabled, oboEnabled, oboRequiredScopes } = useConfig();

  return (
    <header className={cn("sticky top-0 flex h-[60px] items-center gap-2 bg-background px-4", {
      "border-b border-border md:pb-2": !empty,
    })}>
      {/* Toggle visible on mobile only — desktop toggle lives inside the sidebar */}
      <div className="md:hidden">
        <SidebarToggle forceOpenIcon />
      </div>

      {(title || isLoadingTitle) &&
        <h4 className="text-[16px] font-medium truncate">
          {isLoadingTitle ?
            <Skeleton className="w-32 h-6 bg-border" /> :
            title
          }
        </h4>
      }


      <div className="ml-auto flex items-center gap-2">
        {!chatHistoryEnabled && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border-border border-1 bg-muted px-2 py-1 text-foreground text-xs hover:text-foreground"
                >
                  <CloudOffIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">Ephemeral</span>
                </a>
              </TooltipTrigger>
              <TooltipContent>
                <p>Chat history disabled — conversations are not saved. Click to learn more.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {!feedbackEnabled && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border-border border-1 bg-muted px-2 py-1 text-foreground text-xs hover:text-foreground"
                >
                  <MessageSquareOff className="h-3 w-3" />
                  <span className="hidden sm:inline">Feedback disabled</span>
                </a>
              </TooltipTrigger>
              <TooltipContent>
                <p>Feedback submission disabled. Click to learn more.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {oboEnabled && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400 text-xs hover:text-amber-900 dark:hover:text-amber-300"
                >
                  <ShieldAlert className="h-3 w-3" />
                  <span className="hidden sm:inline">OBO scopes required</span>
                </a>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  This endpoint uses on-behalf-of user authorization. Add these scopes to your
                  app via the Databricks UI or databricks.yml:{' '}
                  <strong>{oboRequiredScopes.join(', ')}</strong>.
                  Note: UC function scopes are not yet supported.
                  Click to learn more.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* New Chat button — mobile only; desktop uses the sidebar rail */}
        <Button
          variant="default"
          className="order-2 ml-auto h-8 px-2 md:hidden"
          onClick={() => {
            navigate('/');
          }}
        >
          <PlusIcon />
          <span>New Chat</span>
        </Button>
      </div>
    </header>
  );
}
