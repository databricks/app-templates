import { z } from 'zod';
import { Application, Request } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const CREATE_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS app`;

const CREATE_FLAGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app.booking_flags (
    flag_id      SERIAL PRIMARY KEY,
    booking_id   BIGINT NOT NULL UNIQUE,
    flag_reason  TEXT NOT NULL,
    flagged_by   TEXT NOT NULL DEFAULT 'app-user',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CREATE_NOTES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app.booking_notes (
    note_id      SERIAL PRIMARY KEY,
    booking_id   BIGINT NOT NULL,
    agent_email  TEXT NOT NULL,
    note         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const FlagBody = z.object({
  flag_reason: z.string().min(1).max(500),
});

const NoteBody = z.object({
  note: z.string().min(1).max(2000),
});

function parseBookingId(raw: string): number | null {
  return /^[1-9][0-9]{0,14}$/.test(raw) ? Number(raw) : null;
}

// flagged_by / agent_email record the authenticated user, which Databricks Apps
// set as x-forwarded-email at the gateway. The header is absent in local development.
function actorEmail(req: Request): string | null {
  return req.header('x-forwarded-email') || (process.env.NODE_ENV === 'development' ? 'app-user' : null);
}

export async function setupWanderbricksRoutes(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query(CREATE_SCHEMA_SQL);
    await appkit.lakebase.query(CREATE_FLAGS_TABLE_SQL);
    await appkit.lakebase.query(CREATE_NOTES_TABLE_SQL);
    console.log('[wanderbricks] app.booking_flags and app.booking_notes ready');
  } catch (err) {
    console.warn('[wanderbricks] table setup failed:', (err as Error).message);
  }

  appkit.server.extend((app) => {
    app.get('/api/bookings/:id/flag', async (req, res) => {
      const id = parseBookingId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid booking id' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          'SELECT flag_id, booking_id, flag_reason, flagged_by, created_at FROM app.booking_flags WHERE booking_id = $1',
          [id]
        );
        res.json({ flagged: rows.length > 0, flag: rows[0] ?? null });
      } catch (err) {
        console.error('Failed to read flag:', err);
        res.status(500).json({ error: 'Failed to read flag' });
      }
    });

    app.post('/api/bookings/:id/flag', async (req, res) => {
      const id = parseBookingId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid booking id' });
        return;
      }
      const parsed = FlagBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'flag_reason is required (max 500 characters)' });
        return;
      }
      const flaggedBy = actorEmail(req);
      if (!flaggedBy) {
        res.status(401).json({ error: 'Missing user identity' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.booking_flags (booking_id, flag_reason, flagged_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (booking_id)
             DO UPDATE SET flag_reason = EXCLUDED.flag_reason, flagged_by = EXCLUDED.flagged_by
           RETURNING flag_id, booking_id, flag_reason, flagged_by, created_at`,
          [id, parsed.data.flag_reason, flaggedBy]
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        console.error('Failed to flag booking:', err);
        res.status(500).json({ error: 'Failed to flag booking' });
      }
    });

    app.delete('/api/bookings/:id/flag', async (req, res) => {
      const id = parseBookingId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid booking id' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          'DELETE FROM app.booking_flags WHERE booking_id = $1 RETURNING flag_id',
          [id]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Booking not flagged' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('Failed to unflag booking:', err);
        res.status(500).json({ error: 'Failed to unflag booking' });
      }
    });

    app.get('/api/bookings/:id/notes', async (req, res) => {
      const id = parseBookingId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid booking id' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          'SELECT note_id, booking_id, agent_email, note, created_at FROM app.booking_notes WHERE booking_id = $1 ORDER BY created_at DESC',
          [id]
        );
        res.json(rows);
      } catch (err) {
        console.error('Failed to list notes:', err);
        res.status(500).json({ error: 'Failed to list notes' });
      }
    });

    app.post('/api/bookings/:id/notes', async (req, res) => {
      const id = parseBookingId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid booking id' });
        return;
      }
      const parsed = NoteBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'note is required (max 2000 characters)' });
        return;
      }
      const agentEmail = actorEmail(req);
      if (!agentEmail) {
        res.status(401).json({ error: 'Missing user identity' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.booking_notes (booking_id, agent_email, note)
           VALUES ($1, $2, $3)
           RETURNING note_id, booking_id, agent_email, note, created_at`,
          [id, agentEmail, parsed.data.note]
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        console.error('Failed to add note:', err);
        res.status(500).json({ error: 'Failed to add note' });
      }
    });
  });
}
