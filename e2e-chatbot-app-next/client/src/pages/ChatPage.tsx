import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { useSession } from '@/contexts/SessionContext';
import { useChatData } from '@/hooks/useChatData';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [modelId, setModelId] = useState('chat-model');

  // Use SWR hook for data fetching with automatic caching and deduplication
  const { chatData, error } = useChatData(id, !!session?.user);

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

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-bold text-2xl">Error</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // Show loading if no data or if data doesn't match current ID (stale data)
  if (!chatData || chatData.chat.id !== id) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading chat...</div>
      </div>
    );
  }

  const { chat, messages } = chatData;
  // For now, assume chats are not readonly unless we add proper ACL
  // The server will handle permission checks
  const isReadonly = false;

  // Force React to remount the Chat component when switching threads
  // This ensures UI updates immediately when id changes
  return (
    <Chat
      key={chat.id}
      id={chat.id}
      initialMessages={messages}
      initialChatModel={modelId}
      initialVisibilityType={chat.visibility}
      isReadonly={isReadonly}
      session={session}
      initialLastContext={chat.lastContext ?? undefined}
    />
  );
}
