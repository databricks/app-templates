# MLflow Review App: guide for coding agents

This app is a reviewer UI for MLflow Review Queues: a Python FastAPI server on the MLflow SDK. The
user owns the UI. The template owns `review_queue/` (routes, access checks, `/setup`, the client).

## Rules

- Edit only files in `static/`, plus your own routes in `app.py` (below). You may replace
  `static/` completely (any framework, any build step, as long as the built files are served from
  `static/` and `static/index.html` is the entry page).
- `static/index.html` is only a start page (a link to `/setup`). Replace it with
  the review UI.
- Do not edit `review_queue/` or `security.py`. They hold the access checks that keep
  reviewers to their own queues, and the security headers.
- Get all data through `/_review/review.js`. Do not call MLflow or Databricks APIs from the browser.
- Trace data and answers are untrusted text. Use `textContent` or your framework's escaping.
  Never put them in `innerHTML`.
- Do not add inline `<script>` tags. The server's Content-Security-Policy allows only scripts from
  the app itself (`script-src 'self'`).

## Client API (`import { review } from '/_review/review.js'`)

Every call runs as the signed-in reviewer. Every method returns a Promise.

| Method                                         | Returns                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `review.me()`                                  | the reviewer's email                                                                                                |
| `review.listQueues()`                          | `[{ id, display_name, queue_type, pending_item_count, total_item_count }]`, only queues the reviewer is a member of |
| `review.listItems(queueId, { status })`        | `[{ id, status, trace_id, completed_by }]`; `status` is optional: `'PENDING'`, `'COMPLETE'` or `'DECLINED'`         |
| `review.listMembers(queueId)`                  | the queue's members (emails)                                                                                        |
| `review.getItem(queueId, itemId)`              | `{ item, trace, questions, answers }` (below)                                                                       |
| `review.saveAnswers(queueId, itemId, answers)` | `{ saved: [titles] }`                                                                                               |
| `review.setStatus(queueId, itemId, status)`    | the updated item                                                                                                    |

`getItem` returns:

- `trace`: `{ trace_info: { trace_id, request_preview, response_preview, tags, trace_metadata, ... }, spans: [...] }`.
  `spans` are OpenTelemetry spans. Other reviewers' answers are removed.
- `questions`: each has `title`, `instruction`, `type` (`FEEDBACK` or `EXPECTATION`),
  `enable_comment`, and exactly one input: `pass_fail`, `categorical` (`options`, `multi_select`),
  `numeric` (`min_value`, `max_value`) or `text` (`max_length`).
- `answers`: this reviewer's latest answers, keyed by question **title**: `{ value, rationale }`.

`saveAnswers` takes answers keyed by question title: `{ [title]: { value, rationale? } }`.
`value` must match the question: a boolean for `pass_fail`, one of `options` for `categorical`
(a list when `multi_select`), a number in range for `numeric`, a non-empty string for `text`.
Send `rationale` only when `enable_comment` is true. A bad answer fails the whole call and saves nothing.

Errors are `ReviewError` with `status`: `400` bad input, `404` not found or not a member,
`502` MLflow refused the app (open `/setup` to see why).

## Your own backend routes (optional)

Add FastAPI routes in `app.py`, inside `create_app()` before the static files are mounted, under
`/api/custom/` (for example `@app.get('/api/custom/notes')`). These routes run as the app's service
principal and get no access checks from the template: use the `ReviewQueue` helpers
(`reviewer`, `check_item`, `check_answers`, `list_members`, `save_answers`, `set_status`), or read
the reviewer from the `x-forwarded-email` header and check access yourself. Call them from the UI
with `fetch`. Use plain `def` routes: the MLflow SDK is blocking, and FastAPI runs them in a thread
pool. For a database, add a Lakebase resource and connect with `psycopg`. `recipes/custom-routes/` and
`recipes/lakebase/` are working examples, tested in `tests/test_recipes.py`.

## Not available yet

- Per-item assignees. Items belong to the queue, not to one reviewer. Use `listMembers` for the
  queue's reviewers.
- Dataset-record items. Only trace items are returned.
