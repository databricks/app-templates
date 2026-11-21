import { useState, useEffect } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@databricks/chatbot-core';

export function useMessages({
  status,
}: {
  status: UseChatHelpers<ChatMessage>['status'];
}) {
  const [hasSentMessage, setHasSentMessage] = useState(false);

  useEffect(() => {
    if (status === 'submitted') {
      setHasSentMessage(true);
    }
  }, [status]);

  return { hasSentMessage };
}
