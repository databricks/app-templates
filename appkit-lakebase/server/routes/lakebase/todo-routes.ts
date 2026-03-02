import { z } from 'zod';
import { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS todos (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CreateTodoBody = z.object({ title: z.string().min(1) });

export async function setupSampleLakebaseRoutes(appkit: AppKitWithLakebase) {
  await appkit.lakebase.query(CREATE_TABLE_SQL);

  appkit.server.extend((app) => {
    app.get('/api/lakebase/todos', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(
          'SELECT id, title, completed, created_at FROM todos ORDER BY created_at DESC',
        );
        res.json(result.rows);
      } catch (err) {
        console.error('Failed to list todos:', err);
        res.status(500).json({ error: 'Failed to list todos' });
      }
    });

    app.post('/api/lakebase/todos', async (req, res) => {
      try {
        const parsed = CreateTodoBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'title is required' });
          return;
        }
        const result = await appkit.lakebase.query(
          'INSERT INTO todos (title) VALUES ($1) RETURNING id, title, completed, created_at',
          [parsed.data.title.trim()],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error('Failed to create todo:', err);
        res.status(500).json({ error: 'Failed to create todo' });
      }
    });

    app.patch('/api/lakebase/todos/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const result = await appkit.lakebase.query(
          'UPDATE todos SET completed = NOT completed WHERE id = $1 RETURNING id, title, completed, created_at',
          [id],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Todo not found' });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error('Failed to update todo:', err);
        res.status(500).json({ error: 'Failed to update todo' });
      }
    });

    app.delete('/api/lakebase/todos/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const result = await appkit.lakebase.query(
          'DELETE FROM todos WHERE id = $1 RETURNING id',
          [id],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Todo not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('Failed to delete todo:', err);
        res.status(500).json({ error: 'Failed to delete todo' });
      }
    });
  });
}
