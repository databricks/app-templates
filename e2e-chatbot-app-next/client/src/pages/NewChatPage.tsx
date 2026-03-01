import { useState, useCallback, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { generateUUID } from '@/lib/utils';
import { useSession } from '@/contexts/SessionContext';
import { useLocation } from 'react-router-dom';
import { useChatData } from '@/hooks/useChatData';
import { useAppConfig } from '@/contexts/AppConfigContext';

export default function NewChatPage() {
  const { session } = useSession();
  const { chatHistoryEnabled } = useAppConfig();
  const [id, setId] = useState(() => generateUUID());
  const [modelId, setModelId] = useState('chat-model');
  // Becomes true once the first stream completes so we can fetch feedback.
  const [streamCompleted, setStreamCompleted] = useState(false);

  // Fetch feedback (and chat/messages) after the first exchange finishes.
  // Only enabled in DB mode — ephemeral mode has no persistent data to fetch.
  const { chatData } = useChatData(
    id,
    streamCompleted && chatHistoryEnabled && !!session?.user,
  );

  const handleStreamComplete = useCallback(() => {
    setStreamCompleted(true);
  }, []);

  // Check if the new chat page was navigated to when we're already on the new chat page
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: We need to re-generate the ID when the page is navigated to
  useEffect(() => {
    // Start a new chat when the page is navigated to
    setId(generateUUID());
    setStreamCompleted(false);
  }, [location.key]);

  useEffect(() => {
    // Load model preference from localStorage
    const savedModel = localStorage.getItem('chat-model');
    if (savedModel) {
      setModelId(savedModel);
    }
  }, []);

  if (!session?.user) {
    return null;
  }

  // Note: query param handling can be added here if needed
  // const query = searchParams.get('query');

  return (
    <Chat
      key={id}
      id={id}
      initialMessages={[]}
      initialChatModel={modelId}
      initialVisibilityType="private"
      isReadonly={false}
      session={session}
      feedback={chatData?.feedback ?? {}}
      onStreamComplete={handleStreamComplete}
    />
  );
}
