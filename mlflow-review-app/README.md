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
3. Open the app. Its start page shows whether setup is finished; click **Open setup** (or go to
   `<app-url>/setup`). The setup page shows what the app's service principal can do. If a trace table
   shows ✗, click **Grant access**. This runs the GRANT statements as you, so you need permission to
   manage the trace tables (for example, you own them). You can also run the GRANT statements that
   the page shows.
4. Give reviewers **Can use** on the app.

The first time each user opens the app, Databricks asks them to allow the `sql` scope. The app uses
it only for the **Grant access** button. Workspace admins can approve it for all users.

## Change the UI

Replace the files in `static/` with your UI. `static/index.html` is a start page that shows whether
setup is finished and links to `/setup`. Write your UI with plain JavaScript or any framework, and
import the client:

```js
import { review } from '/_review/review.js';

const queues = await review.listQueues();
const items = await review.listItems(queues[0].id, { status: 'PENDING' });
const { trace, questions, answers } = await review.getItem(queues[0].id, items[0].id);
await review.saveAnswers(queues[0].id, items[0].id, { [questions[0].title]: { value: 'Looks right' } });
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
  adjudicator compares them and saves only the final answer to MLflow (example below).
- **Assign items to reviewers.** Keep an assignments table, and in your UI show each reviewer only
  the items from `review.listItems` that are assigned to them.
- **Your own trace view.** Render `trace.spans` the way your team reads them: tool calls, retrieved
  documents, a chat transcript.
- **Notes and time spent.** Store per-item notes or review time in your database, next to the
  MLflow answers.

### Example: several reviewers, then an adjudicator

Reviewers save drafts to Lakebase; only adjudicators read the drafts and save the final answer to
MLflow. `ReviewQueue` gives your routes the same checks its own routes use:

- `reviewer(request)`: the signed-in reviewer's email.
- `check_item(request, queue_id, item_id)`: 404 unless the reviewer is a queue member and the item is in the queue.
- `check_answers(request, queue_id, answers)`: 400 unless the answers fit the queue's questions.
- `list_members(request, queue_id)`, `save_answers(request, queue_id, item_id, answers)`,
  `set_status(request, queue_id, item_id, status)`.

They raise `ReviewError` with a `status`, which the app returns as `{"error": ...}`. The `can_write`
option stops reviewers from saving to MLflow through `review.saveAnswers`, so drafts are the only way
in for them.

```python
# app.py (add psycopg[binary] to requirements.txt)
import json
import os

import psycopg
from databricks.sdk import WorkspaceClient
from fastapi import Body, FastAPI, Request
from fastapi.staticfiles import StaticFiles

from review_queue import ReviewError, ReviewQueue
from security import SecurityMiddleware

ADJUDICATORS = {"lead@example.com"}
ws = WorkspaceClient()


def is_adjudicator(email: str) -> bool:
    return email.lower() in ADJUDICATORS


def db() -> psycopg.Connection:
    # The Lakebase resource sets PGHOST, PGDATABASE and PGUSER; the password is a short-lived token.
    # ponytail: one connection per request; use psycopg_pool when traffic grows.
    token = ws.postgres.generate_database_credential(endpoint=os.environ["LAKEBASE_ENDPOINT"]).token
    return psycopg.connect(password=token, sslmode="require")


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityMiddleware)
    rq = ReviewQueue(can_write=lambda email, queue_id: is_adjudicator(email))
    rq.mount(app)
    with db() as conn:
        # The app can't create tables in `public`; in its own schema it owns them and needs no grants.
        conn.execute("CREATE SCHEMA IF NOT EXISTS review")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS review.drafts (queue_id TEXT, item_id TEXT, reviewer TEXT,"
            " answers JSONB, PRIMARY KEY (queue_id, item_id, reviewer))"
        )

    def require_adjudicator(request: Request) -> None:
        if not is_adjudicator(rq.reviewer(request)):
            raise ReviewError("Adjudicators only.", 403)

    # Each reviewer saves a draft here instead of to MLflow.
    @app.put("/api/custom/drafts/{queue_id}/{item_id}")
    def save_draft(request: Request, queue_id: str, item_id: str, body: dict = Body(...)):
        rq.check_item(request, queue_id, item_id)
        rq.check_answers(request, queue_id, body.get("answers"))
        with db() as conn:
            conn.execute(
                "INSERT INTO review.drafts VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (queue_id, item_id, reviewer) DO UPDATE SET answers = EXCLUDED.answers",
                (queue_id, item_id, rq.reviewer(request), json.dumps(body["answers"])),
            )
        return {"ok": True}

    # Only adjudicators read everyone's drafts...
    @app.get("/api/custom/drafts/{queue_id}/{item_id}")
    def list_drafts(request: Request, queue_id: str, item_id: str):
        require_adjudicator(request)
        rq.check_item(request, queue_id, item_id)
        with db() as conn:
            rows = conn.execute(
                "SELECT reviewer, answers FROM review.drafts WHERE queue_id = %s AND item_id = %s",
                (queue_id, item_id),
            ).fetchall()
        return [{"reviewer": r, "answers": a} for r, a in rows]

    # ...and send the final answer: the only path to MLflow.
    @app.post("/api/custom/final/{queue_id}/{item_id}")
    def send_final(request: Request, queue_id: str, item_id: str, body: dict = Body(...)):
        require_adjudicator(request)
        rq.save_answers(request, queue_id, item_id, body.get("answers"))
        return rq.set_status(request, queue_id, item_id, "COMPLETE")

    app.mount("/", StaticFiles(directory="static", html=True), name="static")
    return app


app = create_app()
```

Lakebase setup: add a **Lakebase** resource to the app with **Can connect and create**, and pass
its endpoint to the app in `app.yaml`:

```yaml
- name: LAKEBASE_ENDPOINT
  valueFrom: postgres # the resource key
```

The app's service principal can create a schema but not tables in `public`, so `CREATE TABLE` in
`public` stops the app at startup. Keep your tables in a schema the app creates, as above.

In the UI, reviewers open items with `review.getItem` and `PUT` their answers to
`/api/custom/drafts/...`. The adjudicator loads the drafts, picks the final answers, and posts them
to `/api/custom/final/...`. MLflow then holds one answer per question, from the adjudicator.

Limit: queue members can still answer in the managed MLflow review UI, which this app does not
control.

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
- Anyone who can edit the app's code gets the service principal's access.

- Saving the same question twice within about 30 seconds adds a second answer instead of
  replacing the first: MLflow does not show a new answer to reads for a few seconds.

## Develop and test

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                   # access rules, setup checks and grants, and the start and /setup pages in
                         # Chromium (playwright install chromium), against a fake MLflow
DATABRICKS_CONFIG_PROFILE=<profile> MLFLOW_EXPERIMENT_ID=<id> DATABRICKS_WAREHOUSE_ID=<id> \
  REVIEW_APP_DEV_USER=<your email> uvicorn app:app --reload
```

Locally there is no Apps proxy, so `REVIEW_APP_DEV_USER` names the signed-in reviewer.
