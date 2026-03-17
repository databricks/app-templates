import { useNavigate } from 'react-router-dom';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { MessageSquareOff } from 'lucide-react';
import { useConfig } from '@/hooks/use-config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PlusIcon, CloudOffIcon } from './icons';

const DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app';

export function ChatHeader() {
  const navigate = useNavigate();
  const { chatHistoryEnabled, feedbackEnabled } = useConfig();

  return (
    <header className="sticky top-0 flex h-[60px] items-center gap-2 bg-background px-4">
      {/* Toggle visible on mobile only — desktop toggle lives inside the sidebar */}
      <div className="md:hidden">
        <SidebarToggle forceOpenIcon />
      </div>

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
      </div>
    </header>
  );
}
