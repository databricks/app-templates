# Agent Development Guide - E2E Chatbot Application

This guide provides patterns and best practices for AI agents (like Claude Code) working on the UI and API endpoints of this chatbot application.

## Table of Contents

- [UI Development Patterns](#ui-development-patterns)
- [API Endpoint Testing](#api-endpoint-testing)
- [Common UI Tasks](#common-ui-tasks)
- [Debugging Patterns](#debugging-patterns)
- [Performance Optimization](#performance-optimization)

## UI Development Patterns

### React Component Architecture

This application uses React 18.2 with functional components and hooks. Key patterns:

**Component Organization:**
```
client/src/
├── components/
│   ├── ui/              # Radix UI + shadcn components (button, dialog, etc.)
│   ├── elements/        # App-specific components (conversation, greeting, etc.)
│   ├── message.tsx      # Individual message component
│   └── messages.tsx     # Message list container
├── pages/               # Route-level components (ChatPage, etc.)
└── hooks/               # Custom React hooks (useChatData, useMessages, etc.)
```

**When to Create New Components:**
- **UI components** (`components/ui/`): Reusable, generic UI elements
- **Element components** (`components/elements/`): Feature-specific, domain-aware components
- **Page components** (`pages/`): Top-level route components that orchestrate data flow

### Data Fetching with SWR

Use SWR for server state management. Example from `useChatData.ts`:

```typescript
import useSWR from 'swr';

export function useChatData(chatId: string | undefined, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<ChatData | null>(
    chatId && enabled ? `/chat/${chatId}` : null,
    fetchChatData,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      keepPreviousData: true,
      dedupingInterval: 2000,
    },
  );

  return { chatData: data, isLoading, error, mutate };
}
```

**Key Points:**
- Use conditional fetching with `chatId && enabled ? key : null`
- Configure SWR options for chatbot UX (disable revalidation, keep previous data)
- Return `mutate` for manual cache updates
- Handle loading and error states

### AI SDK Integration

Use Vercel AI SDK for streaming responses:

```typescript
import { useChat } from '@ai-sdk/react';

const {
  messages,
  setMessages,
  status,
  sendMessage,
  regenerate,
} = useChat({
  id: chatId,
  api: '/api/chat',
  body: { chatId },
  onFinish: (message) => {
    // Handle completion
  },
});
```

**Key Points:**
- `status` values: `'idle'`, `'streaming'`, `'submitted'`
- Use `setMessages` for optimistic updates
- `sendMessage` and `regenerate` for user actions

### Component Memoization

Use `React.memo` for expensive components with proper equality checks:

```typescript
import { memo } from 'react';
import equal from 'fast-deep-equal';

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // Return false if props changed (re-render needed)
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  if (!equal(prevProps.feedback, nextProps.feedback)) return false;

  // Return true if props equal (skip re-render)
  return true;
});
```

**CRITICAL:** The return value semantics:
- `false` = props changed → re-render component
- `true` = props equal → skip re-render

**Common Mistake:** Always returning `false` causes constant re-renders and can make UI elements disappear or flicker.

### State Management Patterns

**Server State (SWR):**
- Chat history
- User session
- Feedback data

**Client State (useState/useReducer):**
- UI interactions (modals, dropdowns)
- Form inputs
- Temporary UI state

**Stream State (AI SDK):**
- Message streaming
- AI responses
- Tool calls

## API Endpoint Testing

### Testing with curl

The application uses header-based authentication. All API requests require these headers:

```bash
curl -X POST http://localhost:3001/api/endpoint \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-User: user-id" \
  -H "X-Forwarded-Email: user@example.com" \
  -d '{"key": "value"}'
```

**Required Headers:**
- `X-Forwarded-User`: User ID (required)
- `X-Forwarded-Email`: User email (optional, recommended)
- `X-Forwarded-Preferred-Username`: Display name (optional)

**Local Development:** Use your Databricks user ID from the session endpoint:
```bash
# Get your session info
curl http://localhost:3001/api/session \
  -H "X-Forwarded-User: your-user-id" \
  -H "X-Forwarded-Email: your@email.com"
```

### Common API Endpoints

#### Create/Resume Chat

**Streaming Response:**
```bash
curl -N http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-User: test-user" \
  -H "X-Forwarded-Email: test@example.com" \
  -d '{
    "chatId": "optional-chat-id",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

Note: Use `-N` flag for streaming responses.

#### Get Chat History

```bash
curl http://localhost:3001/api/history \
  -H "X-Forwarded-User: test-user" \
  -H "X-Forwarded-Email: test@example.com"
```

#### Get Chat Messages

```bash
curl http://localhost:3001/api/messages/{chatId} \
  -H "X-Forwarded-User: test-user" \
  -H "X-Forwarded-Email: test@example.com"
```

#### Submit Feedback

```bash
curl -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-User: test-user" \
  -H "X-Forwarded-Email: test@example.com" \
  -d '{
    "messageId": "message-uuid",
    "chatId": "chat-uuid",
    "feedbackType": "thumbs_up"
  }'
```

#### Get Feedback for Chat

```bash
curl http://localhost:3001/api/feedback/chat/{chatId} \
  -H "X-Forwarded-User: test-user" \
  -H "X-Forwarded-Email: test@example.com"
```

### Testing Data Flow

To test the full UI data flow:

1. **Create a chat:**
   ```bash
   CHAT_ID=$(curl -s -N http://localhost:3001/api/chat \
     -H "Content-Type: application/json" \
     -H "X-Forwarded-User: test-user" \
     -H "X-Forwarded-Email: test@example.com" \
     -d '{"messages":[{"role":"user","content":"test"}]}' \
     | grep -oE '"chatId":"[^"]+"' | cut -d'"' -f4 | head -1)
   ```

2. **Fetch chat metadata:**
   ```bash
   curl http://localhost:3001/api/chat/$CHAT_ID \
     -H "X-Forwarded-User: test-user" \
     -H "X-Forwarded-Email: test@example.com"
   ```

3. **Fetch messages:**
   ```bash
   curl http://localhost:3001/api/messages/$CHAT_ID \
     -H "X-Forwarded-User: test-user" \
     -H "X-Forwarded-Email: test@example.com"
   ```

4. **Submit feedback:**
   ```bash
   # Get message ID from messages response
   MESSAGE_ID="..."

   curl -X POST http://localhost:3001/api/feedback \
     -H "Content-Type: application/json" \
     -H "X-Forwarded-User: test-user" \
     -H "X-Forwarded-Email: test@example.com" \
     -d "{\"messageId\":\"$MESSAGE_ID\",\"chatId\":\"$CHAT_ID\",\"feedbackType\":\"thumbs_up\"}"
   ```

5. **Verify feedback:**
   ```bash
   curl http://localhost:3001/api/feedback/chat/$CHAT_ID \
     -H "X-Forwarded-User: test-user" \
     -H "X-Forwarded-Email: test@example.com"
   ```

### Using Browser DevTools

Open http://localhost:3000 and use the Network tab:

1. **Filter by Fetch/XHR** to see API calls
2. **Check Request Headers** for auth headers
3. **Inspect Response** for data structure
4. **Monitor EventStream** for streaming responses

**Key Network Requests to Monitor:**
- `/api/session` - Auth session
- `/api/history` - Chat list
- `/api/chat/{id}` - Chat metadata
- `/api/messages/{id}` - Message history
- `/api/feedback/chat/{id}` - Feedback data
- `/api/chat` (POST) - Message streaming

## Common UI Tasks

### Adding a New Feature with Backend Integration

**Example: Adding feedback functionality**

1. **Create database table** (`packages/db/src/schema.ts`):
   ```typescript
   export const feedback = createTable('Feedback', {
     id: uuid('id').primaryKey().notNull().defaultRandom(),
     messageId: uuid('messageId')
       .notNull()
       .references(() => message.id, { onDelete: 'cascade' }),
     feedbackType: varchar('feedbackType', {
       enum: ['thumbs_up', 'thumbs_down'],
     }).notNull(),
   });
   ```

2. **Generate migration:**
   ```bash
   npm run db:generate
   ```

3. **Create backend route** (`server/src/routes/feedback.ts`):
   ```typescript
   export const feedbackRouter: RouterType = Router();
   feedbackRouter.use(authMiddleware);

   feedbackRouter.post('/', [requireAuth], async (req, res) => {
     // Validate with Zod
     const result = schema.safeParse(req.body);

     // Save to database
     const feedback = await createFeedback(result.data);

     return res.status(201).json(feedback);
   });
   ```

4. **Register route** (`server/src/index.ts`):
   ```typescript
   import { feedbackRouter } from './routes/feedback';
   app.use('/api/feedback', feedbackRouter);
   ```

5. **Create data hook** (`client/src/hooks/useFeedback.ts`):
   ```typescript
   export function useFeedback(chatId: string) {
     const { data, mutate } = useSWR(
       `/api/feedback/chat/${chatId}`,
       fetcher
     );

     const submitFeedback = async (feedbackData) => {
       await fetch('/api/feedback', {
         method: 'POST',
         body: JSON.stringify(feedbackData),
       });
       mutate(); // Refresh data
     };

     return { feedback: data, submitFeedback };
   }
   ```

6. **Add to component** (`client/src/components/message.tsx`):
   ```typescript
   const { submitFeedback } = useFeedback(chatId);

   <button onClick={() => submitFeedback({
     messageId,
     chatId,
     feedbackType: 'thumbs_up'
   })}>
     👍
   </button>
   ```

### Debugging Component Re-renders

If UI elements disappear or flicker:

1. **Check React.memo usage:**
   - Ensure comparison function returns correct boolean
   - Verify all props are compared
   - Use `fast-deep-equal` for object/array props

2. **Add console logs:**
   ```typescript
   function MyComponent(props) {
     console.log('[MyComponent] Render', { props });
     // ...
   }
   ```

3. **Use React DevTools Profiler:**
   - Enable "Highlight updates when components render"
   - Record a profile during the issue
   - Check why component re-rendered

4. **Check state management:**
   - Is state being recreated unnecessarily?
   - Are props being recreated with new references?
   - Is memo comparison working correctly?

### Testing UI Changes

1. **Manual testing:**
   ```bash
   npm run dev
   # Open http://localhost:3000
   ```

2. **E2E tests:**
   ```bash
   npm test
   ```

3. **Component-specific tests:**
   ```bash
   npx playwright test --headed --grep "component-name"
   ```

## Debugging Patterns

### Backend Debugging

**Add detailed logging:**
```typescript
console.log('[Route Name] Request received:', {
  body: req.body,
  headers: req.headers,
  session: req.session,
});
```

**Check database queries:**
```bash
npm run db:studio
# Opens Drizzle Studio at http://localhost:4983
```

**Inspect database directly:**
```bash
# Get connection details
npm run db:studio  # Check connection URL in terminal

# Or use psql
PGPASSWORD=your-token psql -h your-host -U your-user -d databricks_postgres -c "
  SELECT * FROM ai_chatbot.\"Message_v2\" LIMIT 10;
"
```

### Frontend Debugging

**React DevTools:**
1. Install React DevTools browser extension
2. Inspect component props/state
3. Use Profiler to track re-renders

**Network debugging:**
1. Open DevTools Network tab
2. Filter by Fetch/XHR
3. Check request/response for API calls
4. Monitor EventStream for streaming

**Console logging:**
```typescript
// Component lifecycle
useEffect(() => {
  console.log('[Component] Mounted/Updated', { props });
  return () => console.log('[Component] Unmounting');
}, [props]);

// Data fetching
const { data } = useSWR(key, async (url) => {
  console.log('[SWR] Fetching:', url);
  const res = await fetch(url);
  const data = await res.json();
  console.log('[SWR] Data:', data);
  return data;
});
```

### Common Issues and Solutions

#### Issue: "offline:chat" error

**Cause:** Database schema mismatch or model initialization failure

**Debug:**
1. Check `packages/db/src/schema.ts` - correct table names?
2. Check migrations applied: `npm run db:studio`
3. Check model initialization in `server/src/routes/chat.ts`

**Solution:** Ensure schema references correct tables (e.g., `Message_v2` not `Message`)

#### Issue: Feedback submission fails with FK violation

**Cause:** Missing user record in database

**Debug:**
```bash
# Check if user exists
npm run db:studio
# Query User table for user ID
```

**Solution:** Add `ensureUserExists()` call before creating feedback:
```typescript
await ensureUserExists({
  id: userId,
  email: req.session.user.email,
});
```

#### Issue: UI disappears after streaming

**Cause:** Incorrect React.memo implementation

**Debug:**
1. Check memo comparison function returns correct boolean
2. Verify all props are compared (including new props like `feedback`)
3. Test memo function logic manually

**Solution:** Fix memo comparison to return `true` when props equal:
```typescript
export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // Check each prop, return false if different
  if (prevProps.status !== nextProps.status) return false;
  // ... other checks

  return true; // Props equal, skip re-render
});
```

#### Issue: "Chat not found" after refresh

**Cause:** Race condition or cache invalidation issue

**Debug:**
1. Check Network tab - is `/api/chat/{id}` called?
2. Check response status code
3. Check SWR cache state in React DevTools

**Solution:** Ensure `useChatData` hook handles loading state correctly

## Performance Optimization

### React Performance

1. **Memoize expensive computations:**
   ```typescript
   const processedMessages = useMemo(
     () => messages.map(processMessage),
     [messages]
   );
   ```

2. **Memoize callbacks:**
   ```typescript
   const handleSubmit = useCallback(
     (data) => submitFeedback(data),
     [submitFeedback]
   );
   ```

3. **Use React.memo for list items:**
   ```typescript
   const MessageItem = memo(({ message }) => (
     <div>{message.content}</div>
   ));
   ```

### SWR Optimization

1. **Configure deduplication:**
   ```typescript
   useSWR(key, fetcher, {
     dedupingInterval: 2000, // Dedupe within 2 seconds
   });
   ```

2. **Disable unnecessary revalidation:**
   ```typescript
   useSWR(key, fetcher, {
     revalidateOnFocus: false,
     revalidateOnReconnect: false,
   });
   ```

3. **Use conditional fetching:**
   ```typescript
   useSWR(shouldFetch ? key : null, fetcher);
   ```

### Database Optimization

1. **Use indexes for common queries:**
   ```typescript
   export const message = createTable('Message_v2', {
     // ...
   }, (table) => ({
     chatIdIdx: index('message_chat_id_idx').on(table.chatId),
   }));
   ```

2. **Batch database operations:**
   ```typescript
   await db.insert(feedback).values([
     { messageId: 'm1', feedbackType: 'thumbs_up' },
     { messageId: 'm2', feedbackType: 'thumbs_down' },
   ]);
   ```

3. **Use transactions for related operations:**
   ```typescript
   await db.transaction(async (tx) => {
     await tx.insert(chat).values(chatData);
     await tx.insert(message).values(messageData);
   });
   ```

## Additional Resources

- [React Documentation](https://react.dev/)
- [SWR Documentation](https://swr.vercel.app/)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Drizzle ORM](https://orm.drizzle.team/docs/overview)
- [Playwright Testing](https://playwright.dev/)

---

**Note for AI Agents:** This guide is designed to help you work effectively on this codebase. When implementing features:
1. Follow the established patterns
2. Test thoroughly using curl and browser
3. Add appropriate logging for debugging
4. Update this guide if you discover new patterns
