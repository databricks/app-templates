'use client';

import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';
import { StickToBottom } from 'use-stick-to-bottom';

type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn(
      'relative flex-1 touch-pan-y overflow-y-auto will-change-scroll',
      className,
    )}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content className={cn('p-4', className)} {...props} />
);
