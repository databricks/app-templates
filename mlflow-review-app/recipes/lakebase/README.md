# Recipe: your own data in Lakebase

Keep data that MLflow doesn't hold (notes, drafts, assignments, time spent) in Lakebase. This recipe
stores one private note per reviewer and item.

## Use it

1. Copy `app.py` over the template's `app.py`.
2. Add `psycopg[binary]==3.3.9` to `requirements.txt`.
3. Add a **Lakebase** resource to the app with **Can connect and create**, and add to `app.yaml`:

   ```yaml
   - name: LAKEBASE_ENDPOINT
     valueFrom: postgres # the resource key
   ```

## What it shows

- **Connecting:** the Lakebase resource sets `PGHOST`, `PGDATABASE` and `PGUSER`. The password is a
  short-lived token from `generate_database_credential`, fetched for each connection.
- **Your own schema:** the app's service principal can create a schema but not tables in `public`, so
  the app creates `review.notes` in its own schema on first use.
- **Access checks:** each route calls `check_item` first, so only queue members reach the database,
  and only for items in the queue.

| Route                                              | Does                 |
| -------------------------------------------------- | -------------------- |
| `GET /api/custom/queues/{queue}/items/{item}/note` | my note (`{ note }`) |
| `PUT /api/custom/queues/{queue}/items/{item}/note` | save my note         |

Tests: `tests/test_recipes.py` runs the routes with an in-memory store in place of Lakebase. The SQL
runs only against a real Lakebase.
