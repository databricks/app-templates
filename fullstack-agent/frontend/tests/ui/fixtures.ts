import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page, type Route } from "@playwright/test";
import { ME, PAGE_REPLIES, READ_TOOL } from "./mock-data";

export { expect };

/** Text the UI must not show: demo language, paths, raw server text. */
export const FORBIDDEN = /As you|As the app|Who did what|\/api\/|grant|raw server text/;

const SCREENS = "test-results/ui-screens";

/** Critical axe rules for page structure. */
const STRUCTURE_RULES = ["heading-order", "page-has-heading-one", "landmark-one-main", "region"];

export type Reply = { status: number; body: string; contentType: string };

export const ok = (body: unknown): Reply => ({ status: 200, body: JSON.stringify(body), contentType: "application/json" });

/** Empty response; for delete requests. */
export const noContent: Reply = { status: 204, body: "", contentType: "application/json" };

/** Failed call response; UI must not show the raw error text. */
export const failed = (status: number, code?: string): Reply => ({
  status,
  body: JSON.stringify(
    code ? { error: { code, message: "raw server text at /api/" } } : { detail: "raw server text at /api/" },
  ),
  contentType: "application/json",
});

type AgentEvent = Record<string, unknown>;

/** Models from /api/models, default first. */
export const MODELS = [
  { id: "sonnet_llm", name: "Claude Sonnet 5.5", images: false, context_window: 1_000_000 },
  { id: "opus_llm", name: "Claude Opus 5.5", images: true, context_window: 1_000_000 },
];

/** SSE stream of events, numbered from firstId. */
export function sse(events: AgentEvent[], firstId = 1): Reply {
  const frames = events.map(
    (event, index) => `id: ${firstId + index}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  return { status: 200, body: frames.join(""), contentType: "text/event-stream" };
}

/** Replay response; events numbered after the requested event ID. */
export function replayed(route: Route, events: AgentEvent[]): Promise<void> {
  const after = Number(new URL(route.request().url()).searchParams.get("after"));
  return route.fulfill(sse(events, after + 1));
}

/** Complete run events: started, given events, completed. */
export function whole(...events: (AgentEvent | AgentEvent[])[]): AgentEvent[] {
  return [{ type: "run.started" }, ...events.flat(), { type: "run.completed" }];
}

/** Complete run as a stream. */
export function run(...events: (AgentEvent | AgentEvent[])[]): Reply {
  return sse(whole(...events));
}

/** Input for a run with content at default effort. */
export function asked(content: string): Record<string, unknown> {
  return { messages: [{ role: "user", content }], effort: "low" };
}

type StoredRun = { id: string; input: Record<string, unknown>; events: AgentEvent[] };

/** Runs as returned by conversation route, events numbered across runs. */
export function storedRuns(...runs: StoredRun[]): StoredRun[] {
  let next = 1;
  return runs.map((item) => ({
    ...item,
    events: item.events.map((event) => ({ id: next++, type: event.type, data: event })),
  }));
}

/** Split text into two deltas as backend does. */
function chunks(text: string): AgentEvent[] {
  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)].filter(Boolean).map((content) => ({ type: "delta", content }));
}

/** Seconds from run start to answer. */
export const WORK_SECONDS = 3;

/** Text deltas, work time, and finished message. */
export function said(text: string): AgentEvent[] {
  return [
    ...chunks(text),
    { type: "work.done", seconds: WORK_SECONDS },
    { type: "message", message: { role: "assistant", content: text } },
  ];
}

/** Text deltas followed by narration to create a note. */
export function narrated(id: number, text: string): AgentEvent[] {
  return [...chunks(text), { type: "narration", id, text }];
}

/** Start of a labeled step. */
export function step(call: string, text: string): AgentEvent {
  return { type: "status", step: call, tool: READ_TOOL, text };
}

/** End of a step. */
export function stepDone(call: string): AgentEvent {
  return { type: "step.done", step: call };
}

/** Complete step: start, tool event (optional), end. */
export function stepped(call: string, text: string, event?: AgentEvent): AgentEvent[] {
  return [step(call, text), ...(event ? [{ ...event, call_id: call }] : []), stepDone(call)];
}

/** Fixed time for fixture tool events. */
export const TOOL_EVENT_TIME = new Date(2026, 9, 10, 14, 0).toISOString();

/** Tool call event; target is object name without catalog. */
export function called(
  tool: string,
  identity: "user" | "app",
  target: string,
  outcome: "allowed" | "denied" | "rejected_by_user" | "failed",
  details: AgentEvent = {},
): AgentEvent {
  return { type: "tool_event", tool, identity, target: `cat.${target}`, outcome, at: TOOL_EVENT_TIME, ...details };
}

/** Route for all run stop requests. */
export const STOP = "POST /api/invocations/{id}/cancel";
const STOP_PATH = /^\/api\/invocations\/[^/]+\/cancel$/;

/** Mock API; replies calls to routes sequentially, last one repeats. */
export class Api {
  readonly calls: string[] = [];
  private readonly bodies: { key: string; body: unknown }[] = [];
  private readonly replies = new Map<string, Reply[]>([
    ["GET /api/me", [ok(ME)]],
    ["GET /api/models", [ok(MODELS)]],
    ...Object.entries(PAGE_REPLIES).map(([route, body]): [string, Reply[]] => [route, [ok(body)]]),
    ["GET /api/sessions", [ok([])]],
    ["GET /api/activity", [ok({ rows: [], next: null })]],
    [STOP, [ok({ stopped: true })]],
  ]);

  reply(route: string, ...replies: Reply[]): void {
    this.replies.set(route, replies);
  }

  /** The JSON bodies sent to one route, oldest first. */
  posted(route: string): any[] {
    return this.bodies.filter((item) => item.key === route).map((item) => item.body);
  }

  async install(page: Page): Promise<void> {
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const key = STOP_PATH.test(path) ? STOP : `${route.request().method()} ${path}`;
      this.calls.push(key);
      if (route.request().postData()) this.bodies.push({ key, body: route.request().postDataJSON() });
      const queue = this.replies.get(key);
      const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (!reply) return route.fulfill(failed(404));
      return route.fulfill(reply);
    });
  }
}

/** Why keyboard-only tests skip WebKit: it tabs only to form controls by default, and phones have no Tab key. */
export const WEBKIT_TABS_TO_FORM_CONTROLS_ONLY =
  "WebKit on macOS tabs only to form controls unless 'Press Tab to highlight each item' is on in System Settings; iPhones have no Tab key";

const MAX_TABS = 40;

/** The thread's registry markup that the specs find. */
export const ASSISTANT_MESSAGE = '[data-slot="aui_assistant-message-root"]';
export const USER_MESSAGE = '[data-slot="aui_user-message-root"]';
export const QUESTION_TEXT = ".aui-user-message-content";
/** The answer's markdown, without the notes' markdown inside their group. */
export const ANSWER_TEXT = '[data-slot="aui_assistant-message-content"] > .aui-md';
/** The run's timeline of notes and steps. */
export const STEPS = '[data-slot="tool-timeline"]';
export const NOTE_TEXT = '[data-slot="note"]';
export const STEP = '[data-slot="step"]';
/** The status row before a run's first note or step. */
export const LOADER = '[data-slot="thinking-indicator"]';
export const VIEWPORT = '[data-slot="aui_thread-viewport"]';
/** The status region that announces the run's step, then its answer. */
export const ANNOUNCER = '[data-slot="answer-status"]';
/** The toggle of a run's timeline, which names how many tools it used. */
export const STEPS_TOGGLE = { name: /^(Using tools|Used \d+ tools?( · \d+s)?|Thinking|Notes|Thoughts)$/ };
const COMPOSER_SHELL = '[data-slot="aui_composer-shell"]';

/**
 * Press Tab, or Shift+Tab, until `target` has focus. Each control on the way
 * must show its focus: an outline or a ring, or the ring around the composer.
 */
export async function tabTo(page: Page, target: Locator, key: "Tab" | "Shift+Tab" = "Tab"): Promise<void> {
  for (let presses = 0; presses < MAX_TABS; presses++) {
    await page.keyboard.press(key);
    const focus = await page.evaluate((shell) => {
      const element = document.activeElement;
      if (!element || element === document.body) return { shown: false, on: "the page" };
      const style = getComputedStyle(element.closest(shell) ?? element);
      const shown = element.matches(":focus-visible") && (style.outlineStyle !== "none" || style.boxShadow !== "none");
      return { shown, on: element.outerHTML.slice(0, 120) };
    }, COMPOSER_SHELL);
    expect(focus.shown, `focus shown on ${focus.on}`).toBe(true);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`${key} did not reach ${target} in ${MAX_TABS} presses.`);
}

/** The browser's notice that it moved resize notifications to the next frame; it reports no fault. */
const RESIZE_OBSERVER_DEFERRED = "ResizeObserver loop completed with undelivered notifications.";

export const test = base.extend<{ api: Api; consoleErrors: string[] }>({
  api: [
    async ({ page }, use) => {
      const api = new Api();
      await api.install(page);
      await use(api);
    },
    { auto: true },
  ],
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        if (error.message !== RESIZE_OBSERVER_DEFERRED) errors.push(error.message);
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export function isPhone(): boolean {
  return test.info().project.use.isMobile ?? false;
}

/** Detects page and scroll-area widths exceeding their viewports. */
function overflowing(page: Page): Promise<string[]> {
  const width = page.viewportSize()?.width ?? 0;
  return page.evaluate((deviceWidth) => {
    const wide: string[] = [];
    const pageBy = document.documentElement.scrollWidth - Math.min(window.innerWidth, deviceWidth || window.innerWidth);
    if (pageBy > 0) wide.push(`page by ${pageBy}px`);
    for (const element of document.querySelectorAll("body *")) {
      if (!["auto", "scroll"].includes(getComputedStyle(element).overflowX)) continue;
      const by = element.scrollWidth - element.clientWidth;
      if (by > 0) wide.push(`${element.tagName.toLowerCase()}.${element.getAttribute("class")} by ${by}px`);
    }
    return wide;
  }, width);
}

/** The longest wait for animations to settle: WebKit never settles the animation of an element removed while it ran. */
const SETTLE_MS = 3_000;

/** Wait for the animations that end, such as a word fading in, so a check sees the screen they settle on. */
function settled(page: Page): Promise<void> {
  return page.evaluate(async (limit) => {
    const ending = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().endTime !== Infinity &&
          ((animation.effect as KeyframeEffect | null)?.target?.isConnected ?? false),
      );
    const timeout = new Promise((resolve) => setTimeout(resolve, limit));
    await Promise.race([Promise.allSettled(ending.map((animation) => animation.finished)), timeout]);
  }, SETTLE_MS);
}

/** Verify screen for text, overflow, a11y and structure, then save screenshot. */
export async function checkScreen(page: Page, name: string): Promise<void> {
  await settled(page);
  await expect(page.locator("body")).not.toHaveText(FORBIDDEN);
  expect(await overflowing(page), "horizontal overflow").toEqual([]);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical" || STRUCTURE_RULES.includes(violation.id),
  );
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" | ")}`)).toEqual(
    [],
  );
  await page.screenshot({ path: `${SCREENS}/${test.info().project.name}/${name}.png`, fullPage: true });
}
