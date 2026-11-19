import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';
import { StickToBottom } from 'use-stick-to-bottom';

type ConversationProps = ComponentProps<typeof StickToBottom>;

// The outer element only sizes the conversation. It needs a bounded height
// (for example `flex-1 min-h-0` in a column), because the element that scrolls
// is StickToBottom.Content's scroll container, sized to 100% of this one.
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn('relative min-h-0 flex-1', className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn('p-4', className)}
    scrollClassName={cn(
      'overscroll-behavior-contain touch-pan-y overflow-y-scroll will-change-scroll',
      scrollClassName,
    )}
    {...props}
  />
);
