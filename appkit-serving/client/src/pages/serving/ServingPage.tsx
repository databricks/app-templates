import { useServingInvoke } from '@databricks/appkit-ui/react';
// For streaming endpoints (e.g. chat models), use useServingStream instead:
// import { useServingStream } from '@databricks/appkit-ui/react';
import { useState } from 'react';

interface ChatChoice {
  message?: { content?: string };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

function extractContent(data: unknown): string {
  const resp = data as ChatResponse;
  return resp?.choices?.[0]?.message?.content ?? JSON.stringify(data);
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ServingPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  const { invoke, loading, error } = useServingInvoke({ messages: [] });
  // For streaming endpoints (e.g. chat models), use useServingStream instead:
  // const { stream, chunks, streaming, error, reset } = useServingStream({ messages: [] });
  // Then accumulate chunks: chunks.map(c => c?.choices?.[0]?.delta?.content ?? '').join('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    const fullMessages = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: userMessage.content },
    ];

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    void invoke({ messages: fullMessages }).then((result) => {
      if (result) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: extractContent(result) },
        ]);
      }
    });
  }

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Model Serving</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Chat with a Databricks Model Serving endpoint.
        </p>
      </div>

      <div className="border rounded-lg flex flex-col h-[600px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
                <p className="text-sm whitespace-pre-wrap">...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="text-destructive text-sm p-2 bg-destructive/10 rounded">
              Error: {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t p-4 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-background"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
