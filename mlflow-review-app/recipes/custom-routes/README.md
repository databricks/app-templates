# Recipe: your own backend routes

Add routes to `app.py` that use the template's access checks, and decide who may save answers.

## Use it

Copy `app.py` over the template's `app.py`. Optionally, add to `app.yaml`:

```yaml
- name: READ_ONLY_REVIEWERS # comma-separated emails that can read but not save
  value: ''
```

## What it shows

| Route                                                | Does                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /api/custom/queues/{queue}/items/{item}/check` | checks `{ answers }` against the queue's questions; saves nothing |
| `GET /api/custom/queues/{queue}/team`                | the queue's other members                                         |

- Your routes run as the app's service principal. The `ReviewQueue` helpers (`reviewer`, `check_item`,
  `check_answers`, `list_members`, `save_answers`, `set_status`) check the signed-in reviewer and raise
  `ReviewError` (404 if not a queue member, 400 for bad answers).
- `can_write` decides who may save through `review.saveAnswers` and `review.setStatus`. Your own routes
  can still call `save_answers` and `set_status` for those users, for example after a review step.

Call the routes from your UI with `fetch`. Tests: `tests/test_recipes.py`.
