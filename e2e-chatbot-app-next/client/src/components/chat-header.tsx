import { useNavigate } from 'react-router-dom';
import { useWindowSize } from 'usehooks-ts';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { useSidebar } from './ui/sidebar';
import { PlusIcon, CloudOffIcon, MessageSquareOff, TriangleAlert } from 'lucide-react';
import { useConfig } from '@/hooks/use-config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app';

const OBO_DOCS_URL =
  'https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth';

export function ChatHeader() {
  const navigate = useNavigate();
  const { open } = useSidebar();
  const { chatHistoryEnabled, feedbackEnabled, oboMissingScopes } = useConfig();

  const { width: windowWidth } = useWindowSize();

  return (
    <>
      <header className="sticky top-0 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
        <SidebarToggle />

        {(!open || windowWidth < 768) && (
          <Button
            variant="outline"
            className="order-2 ml-auto h-8 px-2 md:order-1 md:ml-0 md:h-fit md:px-2"
            onClick={() => {
              navigate('/');
            }}
          >
            <PlusIcon />
            <span className="md:sr-only">New Chat</span>
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!chatHistoryEnabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
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
                    className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
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
        </div>
      </header>

      {oboMissingScopes.length > 0 && (
        <div className="w-full border-b border-red-500/20 bg-red-50 dark:bg-red-950/20 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-700 dark:text-red-400">
              This endpoint requires on-behalf-of user authorization. Add these
              scopes to your app:{' '}
              <strong>{oboMissingScopes.join(', ')}</strong>.{' '}
              Note: UC function scopes are not yet supported.{' '}
              <a
                href={OBO_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Learn more
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
