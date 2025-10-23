import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { useSession } from '@/contexts/SessionContext';
import { convertToUIMessages } from '@/lib/utils';
// import { checkChatAccess } from '@chat-template/core';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatData, setChatData] = useState<any>(null);
  const [modelId, setModelId] = useState('chat-model');

  // if (id && session?.user?.id) {
  // checkChatAccess(id, session?.user.id);

  useEffect(() => {
    // Load model preference from localStorage
    const savedModel = localStorage.getItem('chat-model');
    if (savedModel) {
      setModelId(savedModel);
    }
  }, []);

  useEffect(() => {
    async function loadChat() {
      if (!id || !session?.user) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch chat details - server will handle ACL
        const chatResponse = await fetch(`/api/chat?id=${id}`, {
          credentials: 'include',
        });

        if (!chatResponse.ok) {
          setError('Chat not found or you do not have access');
          return;
        }

        const chat = await chatResponse.json();

        // Fetch messages
        const messagesResponse = await fetch(`/api/history/${id}`, {
          credentials: 'include',
        });

        if (!messagesResponse.ok) {
          throw new Error('Failed to load messages');
        }

        const messagesFromDb = await messagesResponse.json();
        const uiMessages = convertToUIMessages(messagesFromDb);

        setChatData({
          chat,
          messages: uiMessages,
        });
      } catch (err) {
        console.error('Error loading chat:', err);
        setError('Failed to load chat');
      } finally {
        setLoading(false);
      }
    }

    loadChat();
  }, [id, session]);

  if (!session?.user) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading chat...</div>
      </div>
    );
  }

  if (error || !chatData) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-bold text-2xl">Error</h1>
          <p className="text-muted-foreground">{error || 'Chat not found'}</p>
        </div>
      </div>
    );
  }

  const { chat, messages } = chatData;
  // For now, assume chats are not readonly unless we add proper ACL
  // The server will handle permission checks
  const isReadonly = false;

  return (
    <Chat
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
