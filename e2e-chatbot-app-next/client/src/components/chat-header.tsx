import { useNavigate } from 'react-router-dom';
import { useWindowSize } from 'usehooks-ts';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { useSidebar } from './ui/sidebar';
import { PlusIcon, CloudOffIcon, MessageSquareOff, ZapIcon } from 'lucide-react';
import { useConfig } from '@/hooks/use-config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app';

export type BackgroundMode = 'direct' | 'streaming';

const BACKGROUND_MODE_LABELS: Record<BackgroundMode, string> = {
  direct: 'Direct',
  streaming: 'Background (stream)',
};

const BACKGROUND_MODE_ORDER: BackgroundMode[] = ['direct', 'streaming'];

export function ChatHeader({
  backgroundMode,
  onBackgroundModeChange,
}: {
  backgroundMode?: BackgroundMode;
  onBackgroundModeChange?: (value: BackgroundMode) => void;
} = {}) {
  const navigate = useNavigate();
  const { open } = useSidebar();
  const { chatHistoryEnabled, feedbackEnabled } = useConfig();

  const { width: windowWidth } = useWindowSize();

  return (
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
        {onBackgroundModeChange && backgroundMode && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-full px-2 text-xs"
                  onClick={() => {
                    const idx = BACKGROUND_MODE_ORDER.indexOf(backgroundMode);
                    const next =
                      BACKGROUND_MODE_ORDER[
                        (idx + 1) % BACKGROUND_MODE_ORDER.length
                      ];
                    onBackgroundModeChange(next);
                  }}
                >
                  <ZapIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">
                    {BACKGROUND_MODE_LABELS[backgroundMode]}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Mode: {BACKGROUND_MODE_LABELS[backgroundMode]}. Direct = no
                  background. Streaming = background + stream results. Click to
                  cycle.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </header>
  );
}
