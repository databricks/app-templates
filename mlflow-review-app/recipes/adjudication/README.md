# Recipe: several reviewers, then an adjudicator

Each trace gets answers from several reviewers. An adjudicator compares them and sends one final
answer to MLflow.

- Reviewers save drafts to Lakebase. Drafts never go to MLflow.
- Adjudicators see every member's draft and send the final answer. That answer is the only one in
  MLflow, and the item is then complete.
- Reviewers can't save to MLflow through `review.saveAnswers`: `can_write` allows only adjudicators.
- Drafts count only while their reviewer is a queue member.

## Use it

1. Copy `app.py` over the template's `app.py`.
2. Add `psycopg[binary]==3.3.9` to `requirements.txt`.
3. Add a **Lakebase** resource to the app with **Can connect and create**, and add to `app.yaml`:

   ```yaml
   - name: LAKEBASE_ENDPOINT
     valueFrom: postgres # the resource key
   - name: ADJUDICATORS # comma-separated emails
     value: 'lead@example.com'
   - name: REQUIRED_REVIEWS # reviews wanted per item before it is ready to adjudicate
     value: '2'
   ```

The app creates the `review.drafts` table on first use. The app's service principal can create a
schema but not tables in `public`, so keep your tables in a schema the app creates.

## Routes

All routes run as the signed-in reviewer and use the template's checks (queue membership, the item
is in the queue, answers fit the questions).

| Route                                                | Who         | Does                                                           |
| ---------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| `GET /api/custom/me`                                 | anyone      | `{ adjudicator, required_reviews }`                            |
| `GET /api/custom/queues/{queue}/progress`            | members     | per item: number of drafts and whether one is mine; no answers |
| `GET /api/custom/queues/{queue}/items/{item}/draft`  | members     | my draft                                                       |
| `PUT /api/custom/queues/{queue}/items/{item}/draft`  | members     | save my draft (`{ answers }`, same shape as `saveAnswers`)     |
| `GET /api/custom/queues/{queue}/items/{item}/drafts` | adjudicator | every member's draft                                           |
| `POST /api/custom/queues/{queue}/items/{item}/final` | adjudicator | save the final answers to MLflow and complete the item         |

In the UI, list items with `review.listItems`, open one with `review.getItem`, and call these
routes with `fetch`.

Limit: queue members can still answer in the managed MLflow review UI, which this app does not
control.

## Tests

`tests/test_recipe_adjudication.py` runs these routes against a fake MLflow, with an in-memory
store in place of Lakebase. The SQL in `LakebaseDrafts` runs only against a real Lakebase.
