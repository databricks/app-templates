import { useState, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { generateUUID } from '@/lib/utils';
import { useSession } from '@/contexts/SessionContext';
import { useLocation } from 'react-router-dom';

export default function NewChatPage() {
  const { session } = useSession();
  const [id, setId] = useState(() => generateUUID());
  const [modelId, setModelId] = useState('chat-model');

  // Check if the new chat page was navigated to when we're already on the new chat page
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: We need to re-generate the ID when the page is navigated to
  useEffect(() => {
    // Start a new chat when the page is navigated to
    setId(generateUUID());
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
    />
  );
}
