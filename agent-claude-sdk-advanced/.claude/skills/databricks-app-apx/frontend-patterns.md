# Frontend Patterns

## Technology Stack

- **Framework:** React + TypeScript
- **Build tool:** Vite + bun
- **Routing:** @tanstack/react-router
- **Data fetching:** @tanstack/react-query (via Orval-generated hooks)
- **Components:** shadcn/ui
- **API client:** Auto-generated from OpenAPI schema (Orval)

## Query with Suspense (Recommended Pattern)

Always use `useXSuspense` hooks with `Suspense` and `Skeleton` components for data fetching:

```tsx
import { Suspense } from "react";
import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useListItemsSuspense } from "@/lib/api";
import selector from "@/lib/selector";

function ItemsContent() {
  const { data } = useListItemsSuspense(selector());
  return <div>{/* render data */}</div>;
}

export function ItemsPage() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ resetErrorBoundary }) => (
            <div>
              <p>Something went wrong</p>
              <button onClick={resetErrorBoundary}>Try again</button>
            </div>
          )}
        >
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <ItemsContent />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

**Key rule:** Render static elements (headers, layout) immediately. Wrap only the data-fetching parts in `Suspense`.

## Mutation with Cache Invalidation

```tsx
import { useCreateItem } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

function CreateItemButton() {
  const queryClient = useQueryClient();
  const { mutate, isPending } = useCreateItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["listItems"] });
      },
    },
  });

  return (
    <button
      onClick={() => mutate({ data: { name: "New item" } })}
      disabled={isPending}
    >
      {isPending ? "Creating..." : "Create"}
    </button>
  );
}
```

The query key for invalidation matches the `operation_id` from the backend route (e.g., `operation_id="listItems"` → query key `["listItems"]`).

## selector() Usage

The `selector()` function provides a default query selector for clean data destructuring:

```tsx
// No params — simple list query
const { data } = useListItemsSuspense(selector());

// With params — pass query parameters alongside selector
const { data } = useListItemsSuspense({
  params: { page, page_size },
  ...selector(),
});
```

## Component Conventions

- Use **shadcn/ui** components — add via MCP `add_component` or `apx components add <name> --yes`
- Store components in `src/<app>/ui/components/`
- Group by functionality: `src/<app>/ui/components/chat/`, `src/<app>/ui/components/dashboard/`
- If a component is installed to the wrong location (e.g., `src/components/`), move it to `src/<app>/ui/components/`

## Routing

Routes live in `src/<app>/ui/routes/` and use `@tanstack/react-router` file-based routing.

## SSE Streaming (Chat/Agent)

For SSE endpoints (e.g. `/api/chat`), generated React Query hooks **do not work**. Use manual `fetch()` + `ReadableStream`:

```tsx
import { useCallback, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let assistantContent = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") break;
          assistantContent += data;
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: "assistant", content: assistantContent },
          ]);
        }
      }
    }

    setIsStreaming(false);
  }, []);

  return { messages, sendMessage, isStreaming };
}
```

**Key rules:**

- SSE endpoints need manual `fetch()` — do NOT use generated API hooks for streaming.
- Parse the stream line-by-line, looking for `data: ` prefixed lines.
- Use `[DONE]` sentinel to detect stream completion.
- Check configured registries for chat UI components (e.g. `@ai-elements/message`, `@ai-elements/prompt-input`) before building custom ones.

## Data Fetching Rules

- **Always** use `useXSuspense` hooks (not `useX` hooks) for page-level data loading
- **Always** wrap suspense queries in `Suspense` + `ErrorBoundary`
- **Always** provide a `Skeleton` fallback
- **Never** manually call `fetch()` or `axios` — use the generated API hooks (**exception:** SSE streaming endpoints, see above)

## Project Layout

```
src/<app>/ui/
├── components/        # UI components (shadcn/ui)
│   └── ui/            # Installed shadcn base components
├── routes/            # @tanstack/react-router pages
├── lib/
│   ├── api.ts         # Generated API client (Orval) — DO NOT edit manually
│   └── selector.ts    # Default query selector
└── styles/            # CSS styles
```
