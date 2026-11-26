# MLflow Review App

A Databricks App for MLflow Review Queues, written in Python with [FastAPI](https://fastapi.tiangolo.com/)
and the [MLflow Python SDK](https://mlflow.org/docs/latest/). Reviewers open the app, see the queues
they are a member of, and answer each item's questions. You own the whole UI in `static/`. The
template owns `review_queue/` (the API routes, the access checks, the `/setup` page) and a small
browser client, `/_review/review.js`, so your UI never calls MLflow directly.

## Setup

1. In MLflow, create the review queue and its questions, and add reviewers as queue members.
   The experiment must store its traces in Unity Catalog.
2. Create the app from this template. Add two resources:
   - the experiment, key `experiment`, **Can edit**;
   - a SQL warehouse, key `sql-warehouse`, **Can use**.
3. Open the app and click **Open setup** (or go to `<app-url>/setup`). The setup page shows what the app's service principal can do.
   - The first time, it asks you to set `TRACE_DESTINATION` in `app.yaml` to the experiment's
     trace destination (`catalog.schema.prefix`, shown on the page). Set it and redeploy the app.
   - If a trace table shows ✗, click **Grant access**. The page lists each table and privilege; confirm
     to run the GRANT statements as you, so you need permission to manage the trace tables (for
     example, you own them). You can also run the GRANT statements that the page shows.
4. Give reviewers **Can use** on the app.

The first time each user opens the app, Databricks asks them to allow the `sql` scope. The app uses
it only for the **Grant access** button. Workspace admins can approve it for all users.

**Grant access** grants only the trace tables of `TRACE_DESTINATION`: `<prefix>_otel_spans`,
`_otel_logs` and `_otel_annotations`. Experiment editors can change the experiment tags that name
these tables, but not `app.yaml`. If the experiment no longer matches `TRACE_DESTINATION`, or a tag
names another table, the setup page shows an error and grants nothing. So an experiment editor can't
make an admin's click grant the app other tables.

## Change the UI

Replace the files in `static/` with your UI. `static/index.html` is a start page that links to
`/setup`. Write your UI with plain JavaScript or any framework, and
import the client:

```js
import { review } from '/_review/review.js';

const queues = await review.listQueues();
const items = await review.listItems(queues[0].id, { status: 'PENDING' });
const { trace, questions, answers } = await review.getItem(queues[0].id, items[0].id);
await review.saveAnswers(queues[0].id, items[0].id, {
  [questions[0].title]: { value: 'Looks right' },
});
await review.setStatus(queues[0].id, items[0].id, 'COMPLETE');
```

[AGENTS.md](AGENTS.md) has the full client API. Do not edit `review_queue/`: it holds the access
checks.

To use React or another framework, build into `static/` (for example Vite with `outDir: 'static'`),
or change the `StaticFiles` directory in `app.py` to your build folder.

## Build your own review flow

`review.js` gives your UI the MLflow side: the reviewer's queues, each item's trace and questions,
the reviewer's own answers, saving answers, and setting an item's status. For state that MLflow does
not hold, add your own FastAPI routes in `app.py`, and for a database add a Lakebase resource to the
app. Your routes run as the app's service principal and get no access checks from the template: use
the helpers below, or read the reviewer from the `x-forwarded-email` header and check access yourself.

Some flows you can build this way:

- **Several reviewers per trace, then an adjudicator.** Reviewers save drafts to your database; an
  adjudicator compares them and saves only the final answer to MLflow (see Recipes).
- **Assign items to reviewers.** Keep an assignments table, and in your UI show each reviewer only
  the items from `review.listItems` that are assigned to them.
- **Your own trace view.** Render `trace.spans` the way your team reads them: tool calls, retrieved
  documents, a chat transcript.
- **Notes and time spent.** Store per-item notes or review time in your database, next to the
  MLflow answers.

### Helpers for your routes

`ReviewQueue` gives your routes the same checks its own routes use:

- `reviewer(request)`: the signed-in reviewer's email.
- `check_item(request, queue_id, item_id)`: 404 unless the reviewer is a queue member and the item is in the queue.
- `check_answers(request, queue_id, answers)`: 400 unless the answers fit the queue's questions.
- `list_members(request, queue_id)`, `save_answers(request, queue_id, item_id, answers)`,
  `set_status(request, queue_id, item_id, status)`.

They raise `ReviewError` with a `status`, which the app returns as `{"error": ...}`. The `can_write`
option of `ReviewQueue` decides who may save to MLflow through `review.saveAnswers`.

### Recipes

Working examples in `recipes/`, each with tests in `tests/`:

- [`recipes/adjudication`](recipes/adjudication/README.md): several reviewers per trace, then an
  adjudicator. Reviewers save drafts to Lakebase; only adjudicators read the drafts and save the
  final answer to MLflow. It shows custom routes, a Lakebase connection, and `can_write`.

## Who can do what

The app calls MLflow as its service principal. The server checks each reviewer:

- The reviewer is the user the Databricks Apps proxy signed in.
- A reviewer sees only queues where they are a member, and only that queue's items.
- The browser sends only queue and item ids. The server finds the trace and where it is stored.
- Answers must be for that queue's questions and must match each question's type.
- Answers are saved with the reviewer as the source. A new answer replaces only that reviewer's
  earlier answer.
- Other reviewers' answers are not sent to the browser.

Limits:

- An item's `completed_by` is the app's service principal. Each answer still names the reviewer.
- Queue membership is the access check. A reviewer does not need their own access to the trace tables.
- Every user who can open the app can open `/setup`. It shows the app's service principal ID, the
  trace tables with their grants, and MLflow error messages. The app cannot tell who manages it:
  Databricks Apps does not pass the user's permission level on the app to the app.
- The app keeps each queue's members for 30 seconds, so a reviewer removed from a queue keeps access
  for up to 30 seconds.
- Anyone who can edit the app's code gets the service principal's access. With the `sql` scope, they
  can also run SQL as each user who opens the app. Give edit or manage rights on the app only to
  people you trust with both.
- Saving the same question twice within about 30 seconds adds a second answer instead of
  replacing the first: MLflow does not show a new answer to reads for a few seconds.

## Develop and test

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
ruff check . && ruff format --check .   # settings in ruff.toml
pytest                   # access rules, setup checks and grants, and the start and /setup pages in
                         # Chromium (playwright install chromium), against a fake MLflow
DATABRICKS_CONFIG_PROFILE=<profile> MLFLOW_EXPERIMENT_ID=<id> DATABRICKS_WAREHOUSE_ID=<id> \
  REVIEW_APP_DEV_USER=<your email> uvicorn app:app --reload
```

Locally there is no Apps proxy, so `REVIEW_APP_DEV_USER` names the signed-in reviewer.
