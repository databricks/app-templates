import { useEffect, useState } from 'react';
import { useAnalyticsQuery, Button, Input, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';

interface BookingDetail {
  booking_id: number;
  status: string;
  check_in: string;
  check_out: string;
  guests_count: number;
  total_amount: number;
  guest_name: string;
  guest_email: string;
  property_title: string;
  destination: string;
}

interface Note {
  note_id: number;
  booking_id: number;
  agent_email: string;
  note: string;
  created_at: string;
}

interface FlagState {
  flagged: boolean;
  flag: { flag_reason: string; flagged_by: string } | null;
}

export function BookingManager() {
  const [inputId, setInputId] = useState('1');
  const [bookingId, setBookingId] = useState<number>(1);

  const { data, loading, error } = useAnalyticsQuery('booking_detail', {
    bookingId: sql.number(bookingId),
  });

  const [flag, setFlag] = useState<FlagState>({ flagged: false, flag: null });
  const [notes, setNotes] = useState<Note[]>([]);
  const [flagReason, setFlagReason] = useState('');
  const [agentEmail, setAgentEmail] = useState('agent@databricks.com');
  const [noteText, setNoteText] = useState('');
  const [opError, setOpError] = useState<string | null>(null);

  useEffect(() => {
    setOpError(null);
    fetch(`/api/bookings/${bookingId}/flag`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`flag GET failed: ${r.status}`))))
      .then((j) => setFlag(j as FlagState))
      .catch(() => setFlag({ flagged: false, flag: null }));
    fetch(`/api/bookings/${bookingId}/notes`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`notes GET failed: ${r.status}`))))
      .then((j) => setNotes(Array.isArray(j) ? (j as Note[]) : []))
      .catch(() => setNotes([]));
  }, [bookingId]);

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(inputId);
    if (!Number.isFinite(id)) return;
    setBookingId(id);
  };

  const flagBooking = async () => {
    if (!flagReason.trim()) return;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag_reason: flagReason.trim() }),
      });
      if (!res.ok) throw new Error(`Flag failed: ${res.statusText}`);
      const f = (await res.json()) as { flag_reason: string; flagged_by: string };
      setFlag({ flagged: true, flag: f });
      setFlagReason('');
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'flag failed');
    }
  };

  const unflagBooking = async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}/flag`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Unflag failed: ${res.statusText}`);
      setFlag({ flagged: false, flag: null });
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'unflag failed');
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim() || !agentEmail.trim()) return;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_email: agentEmail.trim(), note: noteText.trim() }),
      });
      if (!res.ok) throw new Error(`Add note failed: ${res.statusText}`);
      const created = (await res.json()) as Note;
      setNotes((prev) => [created, ...prev]);
      setNoteText('');
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'add note failed');
    }
  };

  const rows = (Array.isArray(data) ? data : []) as BookingDetail[];
  const detail = rows[0] ?? null;

  return (
    <div className="space-y-4">
      <form onSubmit={lookup} className="flex gap-2">
        <Input placeholder="Booking ID" value={inputId} onChange={(e) => setInputId(e.target.value)} className="w-40" />
        <Button type="submit">Look up</Button>
      </form>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {error && <div className="text-destructive bg-destructive/10 p-3 rounded-md">Error: {error}</div>}

      {detail && (
        <div className="space-y-3">
          <div className="border rounded-md p-3 space-y-1 text-sm">
            <div className="font-semibold">
              {detail.property_title} <span className="text-muted-foreground">— {detail.destination}</span>
            </div>
            <div>
              Guest: {detail.guest_name} (<span className="text-muted-foreground">{detail.guest_email}</span>)
            </div>
            <div>
              {detail.check_in} → {detail.check_out} · {detail.guests_count} guests · $
              {Number(detail.total_amount).toLocaleString()} ·{' '}
              <span className="uppercase text-xs font-medium">{detail.status}</span>
            </div>
          </div>

          <div className="border rounded-md p-3 space-y-2">
            <div className="text-sm font-semibold">
              Flag status:{' '}
              {flag.flagged ? (
                <span className="text-destructive">FLAGGED — {flag.flag?.flag_reason}</span>
              ) : (
                <span className="text-muted-foreground">not flagged</span>
              )}
            </div>
            {flag.flagged ? (
              <Button variant="outline" size="sm" onClick={() => void unflagBooking()}>
                Clear flag
              </Button>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="Reason for flagging"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  className="flex-1"
                />
                <Button size="sm" onClick={() => void flagBooking()} disabled={!flagReason.trim()}>
                  Flag for review
                </Button>
              </div>
            )}
          </div>

          <div className="border rounded-md p-3 space-y-3">
            <div className="text-sm font-semibold">Notes</div>
            <form onSubmit={(e) => void addNote(e)} className="space-y-2">
              <Input placeholder="agent@email" value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)} />
              <Textarea
                placeholder="Add a note about this booking..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
              />
              <Button type="submit" size="sm" disabled={!noteText.trim() || !agentEmail.trim()}>
                Add note
              </Button>
            </form>
            {notes.length === 0 ? (
              <div className="text-muted-foreground text-sm">No notes yet.</div>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.note_id} className="text-sm border-l-2 pl-3">
                    <div className="text-muted-foreground text-xs">
                      {n.agent_email} · {new Date(n.created_at).toLocaleString()}
                    </div>
                    <div>{n.note}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {opError && <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">{opError}</div>}
    </div>
  );
}
