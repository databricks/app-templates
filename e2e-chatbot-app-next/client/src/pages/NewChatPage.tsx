import { useState, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { useSession } from '@/contexts/SessionContext';

export default function NewChatPage() {
  const { session } = useSession();
  const [id] = useState(() => generateUUID());
  const [modelId, setModelId] = useState(DEFAULT_CHAT_MODEL);

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
