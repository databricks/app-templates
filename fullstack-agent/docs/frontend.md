# Frontend

The chat UI is a React app in `frontend/`, built into `app/static/`, that calls only the agent's run stream and `/api` routes ([Backend](backend.md)).

## Stack and layout

The UI uses React 19, TypeScript, Vite and Tailwind CSS 4, on assistant-ui (`@assistant-ui/react` 0.15.25) with its external store runtime, and shadcn/ui on Radix, pinned exactly in `frontend/package.json`. Under `frontend/`:

- `src/app/app.tsx`: the assistant-ui runtime over the app's chat state, its adapters and the page switch.
- `src/app/router.ts`: hash routes, because the agent serves `static/` with no fallback page: `#/assistant/<conversation ID>`, `#/activity` and one per use-case page. An unknown route opens the assistant.
- `src/features/chat/`: `use-agent-chat.ts` (conversations, runs, Stop, replace, decisions, ratings), `events.ts` (the reducer), `messages.ts` (replay and conversion), `api.ts`, `adapters.ts` (images, voice), `components/`.
- `src/features/activity/`: `/api/activity` pages merged with this tab's live rows.
- `src/features/user-data/`, `src/features/reference-data/`, `src/config/`: the use case's UI ([Customization](customization.md#frontend)).
- `src/components/assistant-ui/`: registry elements in `elements/`, and the Markdown renderers.

Most features, such as Stop, edit, regenerate, the message queue and the Ctrl+K or Cmd+K menu, come from assistant-ui. A queued message uses the model chosen when it leaves the queue. `@` mentions of the user's data go in as plain text. The model and effort menu needs two models; a ring by Send shows how full the last run left the context window. Thumbs show only under a finished answer of a stored run, and reopened answers show unrated.

`useLoaded` (`src/lib/api-client.ts`) loads on mount, retry and `refresh` change, dropping stale responses. The profile, models and page data load once per tab; `usePageData(confirmedChanges)` in `src/config/pages.ts` reloads the user's data after each change the tab confirms. A 401 from any route signs the app out with a support reference made from the error code.

## Event replay

Live runs and reopened conversations share one reducer, so both show the same.

1. Live. `streamInvocation` (`src/lib/sse.ts`) posts the run with `X-Routing-Key` set to the conversation's ID, retries once after a 502, and reads server-sent events. A stream that ends before `run.completed` or `run.failed` replays from the last event ID at most 3 times, waiting 1, 2, then 4 seconds after a dropped connection; 75 seconds without data counts as a cut. A repeated event ID is skipped.
2. Reduce. `applyEvent(messages, messageId, event)` (`src/features/chat/events.ts`) is a pure function over the message model in `types.ts`.
3. Reopen. `loadedMessages` (`messages.ts`) rebuilds each question from `GET /api/sessions/{id}` and replays its run's events through `applyEvent`, skipping runs a `replaced` run superseded. A run still going resumes from its last event.
4. Convert. `toThreadMessage` maps messages to assistant-ui parts: `text`, `reasoning` (notes, thoughts), `tool-call` (steps with the server's times, and approval cards as `confirm_action`), `data` (displays) and `source` (reads).

Handle a new event in `applyEvent` only, never in a separate load path. The chat also:

- Takes step times from `status.at` and `step.done.at`, and "worked Ns" from `work.done`. It takes a question's time from `received.at` when reopened and from the browser's clock while live.
- Shows the answer finished at `usage`, before `run.completed`.
- Replaces the reply of a refused model call (a `denied` `model` `tool_event`) with the guardrail notice and two starter questions for `POLICY_BLOCKED`, otherwise with the text in `components/run-status.tsx`.
- Shows a decision's run only on its card, unless it fails.
- On Stop, aborts the reader, posts the cancel and marks the answer "Stopped by you" whatever the server answers.
- Shows "Thinking" after a display or a card while no step runs, until the next note, step or text (`RunIndicator` in `components/thread.tsx`).

## Displays and sources

`src/features/chat/components/displays.tsx` registers one data renderer, a registry element, per view:

- `table`: `DataTable`. Decimals arrive as strings and become numbers in numeric columns.
- `number`: `NumberTicker`. `details`: `SpecSheet`.
- `questions`: `OptionList` for one question, `QuestionFlow` for several.
- `suggestion`: `RecommendationCard`. `comparison`: `ComparisonCard`. `report`: `ResearchReport`.
- `plan`: `TodoList`, only the latest plan, in the first plan's place.

A view with no renderer shows nothing. An answered question or accepted suggestion goes as the user's next message. Questions and suggestions are read-only once answered, during a run, and when reopened. The approval card (`components/approval-card.tsx`) takes each action's text and labels from `src/config/actions.ts`, or falls back to a generic card.

Sources. Each step with an `allowed` read `tool_event` becomes a `source` part per target, titled from `src/config/tools.ts`, shown as a chip under the answer. The model's `(source:<table>)` markers become numbered citations of that table's source (`components/cited-text.tsx`); a marker that names no table the run read shows nothing. Read-aloud and screen reader announcements leave the markers out; copy keeps them.

## Markdown

`src/components/assistant-ui/elements/markdown-text.tsx` renders answers with `@assistant-ui/react-markdown`, remark-gfm and remark-math, in a safe subset:

- Images and links show only their text, so an answer can't load a URL. Raw HTML shows as text.
- LaTeX: `$...$`, `$$...$$`, `\(...\)` and `\[...\]`; a `$` before a digit stays a currency sign. KaTeX runs with `trust: false`, `maxSize: 2` and `maxExpand: 100`, shows errors as text (`src/components/assistant-ui/tex.tsx`), and renders remark-math's nodes in a lazy module, not through the synchronous rehype-katex. `katex` is pinned at 0.19.0, with an npm `overrides` entry for remark-math's copy, because older releases can bypass `trust`.
- Code: `react-syntax-highlighter`'s Prism light build with bash, javascript, json, python, sql and typescript; others show as plain code. `@assistant-ui/react-syntax-highlighter` would add every grammar.
- Mermaid: beautiful-mermaid, which escapes HTML in labels, without `style`, `classDef` and `linkStyle` lines, which could load a URL.
- KaTeX, the highlighter and Mermaid load on first use (`src/components/assistant-ui/fences.tsx`).

## Images and voice

- The attach button shows while the chosen model reads images (`images` in `app/agent/models.toml`), up to 3 a question (`src/features/chat/components/models.tsx`).
- The picker takes PNG, JPEG, GIF and WebP (`src/features/chat/adapters.ts`), and a file over 1.4 MB shows an error, keeping the data URL under the backend's 2,000,000-character cap. Paste and drop are off.
- Images go as `input_image` data URLs, checked again in `app/runtime/schemas.py`.
- Choosing a model without images removes them. For a question with images, Regenerate offers only image models and an edit runs on its first model.
- Dictation and read-aloud use the browser's Web Speech API through assistant-ui's adapters, where available.

## Build

- `make build` type-checks with `tsc --noEmit` and writes the committed `app/static/` ([Checks](development.md#checks)).
- The agent serves it with gzip from 1,000 bytes (`app/runtime/frontend.py`) and security headers (`app/runtime/middleware.py`): a Content Security Policy of `default-src 'self'` allowing inline styles, `data:` and `blob:` images and no framing, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and HSTS.
- `make dev` serves the source with Vite against a local agent ([Local loop](development.md#local-loop)).

## Registry items

Before you add or change a UI component, check whether assistant-ui has it as a primitive or a registry element.

- `node frontend/scripts/registry-add.mjs <item or URL>...` installs a name from shadcn's `new-york-v4` registry, or a URL such as an assistant-ui element, with its registry dependencies. It writes under `frontend/src` with imports rewritten, skips existing files, and prints the npm dependencies to pin exactly ([Dependency changes](development.md#dependency-changes)) and the CSS to add.
- The installed files are the app's own, many edited for contrast, touch size and gating, so upgrade them by hand.
- The repo doesn't use `npx shadcn add`: it asks npm for versions a private mirror may lack.

## UI tests

`npm --prefix frontend run test:ui` (`frontend/playwright.ui.config.ts`) tests the production build with no workspace ([other suites](development.md#tests)):

- It builds into `frontend/dist`, serves it with `vite preview` on `127.0.0.1:8771`, and answers `/api` calls from fixtures, or 404.
- The projects are `phone` (390 by 844, Chromium, touch), `phone-webkit` (an emulated iPhone 15), `tablet` (768 by 1024) and `desktop` (1440 by 900). Install both browsers with `npx --prefix frontend playwright install chromium webkit` or `make install`.
- `tests/ui/fixtures.ts`: `api.reply(route, ...replies)` sets a route's responses in order; `sse`, `run` and `storedRuns` build runs. An unexpected console or page error fails the test.
- `checkScreen(page, name)` checks for text the UI must never show (paths, raw server text), horizontal overflow, and axe's serious and critical violations and structure rules, then saves `frontend/test-results/ui-screens/<project>/<name>.png`.
- The generic specs mock a `read_records` read and the `rename_record` and `archive_record` actions; the use case's files are `mock-data.ts`, `pages.spec.ts` and `actions.spec.ts`.
