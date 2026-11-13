import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { href } from "../../app/router";
import { Icon } from "../../components/icons";
import { Loading } from "../../components/loading";
import { EmptyPanel, PageSection, SEGMENTED } from "../../components/page";
import { ServiceProblem } from "../../components/service-problem";
import { ACTIVITY_EMPTY } from "../../config/tools";
import { useLoaded } from "../../lib/api-client";
import { dayLabel, formatTime, NEW_CONVERSATION } from "../../lib/format";
import type { ActivityEvent } from "../../types/events";
import { type ActivityRow, getActivity } from "./api";
import { type ActivityKind, type ActivityText, activityText } from "./activity-text";

type Filter = "all" | Exclude<ActivityKind, "app">;

type Row = { event: ActivityEvent; text: ActivityText };

const FILTERS: { filter: Filter; label: string; empty: string }[] = [
  {
    filter: "all",
    label: "All",
    empty: ACTIVITY_EMPTY,
  },
  { filter: "data", label: "Your data", empty: "The assistant hasn't viewed your data in the last 90 days." },
  { filter: "change", label: "Changes", empty: "No changes yet. Changes you confirm or cancel appear here." },
];

// Convert stored row to tool event format for unified handling
function storedEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.activity_id,
    at: row.at,
    tool: row.tool,
    identity: row.identity,
    target: row.target,
    outcome: row.outcome,
    status: row.status ?? undefined,
    reference: row.reference ?? undefined,
    proposal_id: row.proposal_id ?? undefined,
    runId: row.run_id,
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title,
  };
}

// Deduplicate events by run and title, newest first
function rowsOf(events: ActivityEvent[]): Row[] {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  unique.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, Row>();
  for (const event of unique) {
    const text = activityText(event);
    if (!text) continue;
    const key = `${event.runId}:${text.title}`;
    if (!rows.has(key)) rows.set(key, { event, text });
  }
  return [...rows.values()].reverse();
}

function byDay(rows: Row[], now: Date): { day: string; rows: Row[] }[] {
  const groups: { day: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const day = dayLabel(row.event.at, now);
    const group = groups.find((item) => item.day === day);
    if (group) group.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

function ActivityItem({ event, text }: Row) {
  const approved = text.kind === "change" && event.outcome === "allowed";
  return (
    <li
      data-slot="activity-row"
      className="grid grid-cols-[52px_20px_minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-1 border-t px-5 py-3.5 first:border-t-0 max-md:grid-cols-[20px_minmax(0,1fr)] max-md:px-4"
    >
      <time className="text-muted-foreground pt-px text-sm max-md:col-start-2 max-md:row-start-1 max-md:p-0 max-md:text-[13px]" dateTime={event.at}>
        {formatTime(new Date(event.at))}
      </time>
      <Icon name={text.icon} className="text-muted-foreground mt-0.5 max-md:col-start-1 max-md:row-span-2 max-md:row-start-1" />
      <div className="max-md:col-start-2">
        <p data-slot="activity-title" className="font-medium">
          {text.title}
        </p>
        {text.detail ? (
          <p data-slot="activity-meta" className="text-muted-foreground text-sm wrap-anywhere">
            {text.detail}
          </p>
        ) : null}
        <p data-slot="activity-meta" className="text-muted-foreground text-sm wrap-anywhere">
          {event.conversationId ? (
            <>
              Conversation:{" "}
              <a className="text-primary underline underline-offset-2" href={href("assistant", event.conversationId)}>
                {event.conversationTitle ?? NEW_CONVERSATION}
              </a>
            </>
          ) : (
            "From a conversation you deleted"
          )}
        </p>
      </div>
      <Badge variant={approved ? "default" : "secondary"} className="mt-px max-md:col-start-2 max-md:mt-1 max-md:justify-self-start">
        {text.badge}
      </Badge>
    </li>
  );
}

// Load paginated older activity rows on demand
function useOlderPages(next: string | null | undefined) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const after = cursor === undefined ? next : cursor;
  const more = async () => {
    if (!after) return;
    setState("loading");
    try {
      const page = await getActivity(after);
      setRows((list) => [...list, ...page.rows]);
      setCursor(page.next);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return { rows, hasMore: Boolean(after), state, more };
}

// Show assistant activity (reads and changes) with filters and pagination
export function ActivityPage({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const first = useLoaded(getActivity);
  const older = useOlderPages(first.value?.next);
  const stored = [...(first.value?.rows ?? []), ...older.rows].map(storedEvent);
  const rows = rowsOf([...stored, ...events]);
  const shown = rows.filter((row) => filter === "all" || row.text.kind === filter);
  const empty = FILTERS.find((item) => item.filter === filter)?.empty;
  const now = new Date();
  return (
    <PageSection
      titleId="activity-title"
      title="Assistant activity"
      description="What the assistant viewed or changed for you in the last 90 days."
    >
      {first.failed ? (
        <ServiceProblem title="We can't show your activity right now" onRetry={first.retry} />
      ) : !first.value ? (
        <Loading text="Loading your activity" />
      ) : null}
      {first.value && rows.length > 0 ? (
        <div className={SEGMENTED} role="group" aria-label="Show">
          {FILTERS.map((item) => (
            <button
              key={item.filter}
              type="button"
              aria-pressed={item.filter === filter}
              onClick={() => setFilter(item.filter)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {!first.value ? null : shown.length === 0 ? (
        <EmptyPanel>{empty}</EmptyPanel>
      ) : (
        byDay(shown, now).map((group) => (
          <section key={group.day}>
            <h2 className="text-muted-foreground mb-2.5 text-[15px] font-semibold">{group.day}</h2>
            <Card className="gap-0 py-0">
              <ol>
                {group.rows.map((row) => (
                  <ActivityItem key={row.event.id} {...row} />
                ))}
              </ol>
            </Card>
          </section>
        ))
      )}
      {first.value && older.state === "failed" ? (
        <ServiceProblem title="We can't show more of your activity right now" onRetry={older.more} />
      ) : first.value && older.hasMore ? (
        <Button variant="outline" size="lg" className="self-start" disabled={older.state === "loading"} onClick={older.more}>
          {older.state === "loading" ? "Loading more" : "Show more"}
        </Button>
      ) : null}
    </PageSection>
  );
}
