import type { Page } from "@playwright/test";
import type { ActivityRow } from "../../src/features/activity/api";
import { PRODUCT_NAME } from "../../src/config/brand";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import { IDENTITY_LABEL } from "../../src/config/tools";
import {
  ANSWER_TEXT,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  failed,
  ok,
  type Reply,
  run,
  said,
  stepped,
  test,
  TOOL_EVENT_TIME,
} from "./fixtures";
import { ACTIVITY } from "./mock-data";

const NOW = new Date(TOOL_EVENT_TIME);
const INVOKE = "POST /api/invocations";
const { question: QUESTION, answer: ANSWER, userRead: USER_READ, appRead: APP_READ, change: CHANGE } = ACTIVITY;
const RAW_ERROR = "PERMISSION_DENIED: User does not have MODIFY on Table 'data.records'.";

const READS = run(
  called("model", "user", ACTIVITY.model, "allowed"),
  stepped("call_1", USER_READ.step, called(USER_READ.tool, "user", USER_READ.target, "allowed")),
  stepped("call_2", APP_READ.step, called(APP_READ.tool, "app", APP_READ.target, "allowed")),
  stepped("call_3", `${USER_READ.step} again`, called(USER_READ.tool, "user", USER_READ.target, "allowed")),
  said(ANSWER),
);

const PROPOSED = run({
  type: "confirmation_required",
  proposal_id: "p1",
  action: CHANGE.action,
  args: CHANGE.args,
});

function decided(outcome: "allowed" | "denied" | "rejected_by_user", details = {}): Reply {
  const event = called(CHANGE.action, "user", CHANGE.target, outcome, { proposal_id: "p1", ...details });
  return run(event, said("The backend's own reply"));
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function answered(page: Page): Promise<void> {
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "complete");
}

async function openActivity(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistant activity");
}

const filters = (page: Page) => page.getByRole("group", { name: "Show" }).getByRole("button");
const titles = (page: Page) => page.locator('[data-slot="activity-title"]');

test.beforeEach(async ({ page, api }) => {
  await page.clock.setFixedTime(NOW);
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

test("before any activity the page says so", async ({ page }) => {
  await page.goto("/");
  await openActivity(page);

  await expect(page).toHaveURL(/#\/activity$/);
  await expect(page).toHaveTitle(`Activity | ${PRODUCT_NAME}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Assistant activity");
  await expect(heading).toBeFocused();
  await expect(page.locator("#activity-title + p")).toContainText("in the last 90 days");
  await expect(page.getByText("No activity yet.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Show" })).toHaveCount(0);
  await checkScreen(page, "activity-empty");
});

test("an answer's reads show their identity badge, each linking to its conversation", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, READS);
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await openActivity(page);

  const rows = page.locator('[data-slot="activity-row"]');
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Today"]);
  await expect(titles(page)).toHaveText([APP_READ.title, USER_READ.title]);
  await expect(rows.locator('[data-slot="badge"]')).toHaveText([IDENTITY_LABEL.app, IDENTITY_LABEL.user]);
  await expect(rows.locator("time")).toHaveText(["14:00", "14:00"]);
  await expect(rows.getByRole("link", { name: QUESTION })).toHaveCount(2);
  await checkScreen(page, "activity");

  await rows.nth(1).getByRole("link", { name: QUESTION }).click();
  await expect(page).toHaveURL(/#\/assistant\/c1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(QUESTION);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
});

test("an approved change shows its reference, and each filter shows only its rows", async ({ page, api }) => {
  api.reply(INVOKE, READS, PROPOSED, decided("allowed", { status: "OK", reference: CHANGE.reference }));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await ask(page, CHANGE.question);
  const card = page.getByTestId("confirm-card");
  await card.getByRole("button", { name: CHANGE.approve }).click();
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Completed");
  await openActivity(page);

  await expect(filters(page)).toHaveText(["All", IDENTITY_LABEL.user, "Changes"]);
  await expect(filters(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText([CHANGE.done, APP_READ.title, USER_READ.title]);
  const change = page.locator('[data-slot="activity-row"]').first();
  await expect(change.locator('[data-slot="activity-meta"]').first()).toHaveText(`Reference ${CHANGE.reference}`);
  await expect(change.locator('[data-slot="badge"]')).toHaveText("Completed");

  await filters(page).nth(1).click();
  await expect(filters(page).nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(filters(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText([USER_READ.title]);
  await checkScreen(page, "activity-your-data");

  await filters(page).nth(2).click();
  await expect(filters(page).nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(filters(page).nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText([CHANGE.done]);
  await checkScreen(page, "activity-changes");

  await filters(page).nth(0).click();
  await expect(titles(page)).toHaveCount(3);
});

test("a filter without rows says so", async ({ page, api }) => {
  api.reply(INVOKE, run(called(APP_READ.tool, "app", APP_READ.target, "allowed"), said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await openActivity(page);
  await expect(titles(page)).toHaveText([APP_READ.title]);

  await filters(page).nth(1).click();
  await expect(titles(page)).toHaveCount(0);
  await expect(page.getByText("The assistant hasn't viewed your data in the last 90 days.")).toBeVisible();

  await filters(page).nth(2).click();
  await expect(page.getByText("No changes yet.")).toBeVisible();
  await checkScreen(page, "activity-filter-empty");
});

test("a refused read says what couldn't be viewed, without the raw error", async ({ page, api }) => {
  api.reply(
    INVOKE,
    run(called(ACTIVITY.refusedRead.tool, "user", ACTIVITY.refusedRead.target, "denied", { error: RAW_ERROR }), said(ANSWER)),
  );
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await openActivity(page);

  await expect(titles(page)).toHaveText([ACTIVITY.refusedRead.title]);
  await expect(page.locator('[data-slot="activity-row"] [data-slot="badge"]')).toHaveText(IDENTITY_LABEL.user);
  await expect(page.locator("body")).not.toContainText("MODIFY");
});

for (const { name, button, outcome, details, detail } of [
  { name: "declined", button: "Cancel", outcome: "rejected_by_user", details: {}, detail: "You cancelled this change." },
  {
    name: "rule",
    button: CHANGE.approve,
    outcome: "denied",
    details: { status: "REJECTED", error: CHANGE.rule },
    detail: CHANGE.rule,
  },
  {
    name: "refused",
    button: CHANGE.approve,
    outcome: "denied",
    details: { status: "DENIED", error: RAW_ERROR },
    detail: "This change isn't permitted for you.",
  },
] as const) {
  test(`a ${name} change shows as Not changed`, async ({ page, api }) => {
    api.reply(INVOKE, PROPOSED, decided(outcome, details));
    await page.goto("/");
    await ask(page, CHANGE.question);
    const card = page.getByTestId("confirm-card");
    await card.getByRole("button", { name: button }).click();
    await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Not changed");
    await openActivity(page);

    const row = page.locator('[data-slot="activity-row"]');
    await expect(row.locator('[data-slot="activity-title"]')).toHaveText([CHANGE.title]);
    await expect(row.locator('[data-slot="activity-meta"]').first()).toHaveText(detail);
    await expect(row.locator('[data-slot="badge"]')).toHaveText("Not changed");
    await expect(page.locator("body")).not.toContainText("MODIFY");
    await expect(page.locator("body")).not.toContainText("The backend's own reply");
    await checkScreen(page, `activity-not-changed-${name}`);
  });
}

function stored(n: number, details: Partial<ActivityRow> = {}): ActivityRow {
  return {
    activity_id: `old-run-${n}:2`,
    run_id: `old-run-${n}`,
    at: new Date(NOW.getTime() - n * 60_000).toISOString(),
    tool: USER_READ.tool,
    identity: "user",
    target: `cat.${USER_READ.target}`,
    outcome: "allowed",
    status: null,
    reference: null,
    proposal_id: null,
    conversation_id: "c1",
    conversation_title: "Earlier question",
    ...details,
  };
}

test("stored rows show after a reload, newest first, with their conversation", async ({ page, api }) => {
  api.reply(
    "GET /api/activity",
    ok({
      rows: [
        stored(1, { tool: APP_READ.tool, identity: "app", target: `cat.${APP_READ.target}` }),
        stored(2),
      ],
      next: null,
    }),
  );
  await page.goto("/");
  await openActivity(page);
  await expect(titles(page)).toHaveText([APP_READ.title, USER_READ.title]);

  await page.reload();

  await expect(titles(page)).toHaveText([APP_READ.title, USER_READ.title]);
  await expect(page.locator('[data-slot="activity-row"]').first().getByRole("link", { name: "Earlier question" })).toBeVisible();
});

test("a live row that is also stored shows once", async ({ page, api }) => {
  api.reply(INVOKE, READS);
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const runId = api.posted(INVOKE)[0].id;
  api.reply(
    "GET /api/activity",
    ok({
      rows: [stored(0, { activity_id: `${runId}:3`, run_id: runId, at: TOOL_EVENT_TIME, conversation_title: QUESTION })],
      next: null,
    }),
  );

  await openActivity(page);

  await expect(titles(page)).toHaveText([APP_READ.title, USER_READ.title]);
});

test("a deleted conversation's rows say so instead of linking", async ({ page, api }) => {
  api.reply(
    "GET /api/activity",
    ok({ rows: [stored(1, { conversation_id: null, conversation_title: null })], next: null }),
  );
  await page.goto("/");
  await openActivity(page);

  const row = page.locator('[data-slot="activity-row"]');
  await expect(row.getByText("From a conversation you deleted")).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);
});

test("a failed load offers Try again", async ({ page, api }) => {
  api.reply("GET /api/activity", failed(502, "QUERY_FAILED"), ok({ rows: [stored(1)], next: null }));
  await page.goto("/");
  await openActivity(page);
  const problem = page.getByRole("alert");
  await expect(problem).toContainText("We can't show your activity right now");
  await checkScreen(page, "activity-failed");

  await problem.getByRole("button", { name: "Try again" }).click();

  await expect(titles(page)).toHaveText([USER_READ.title]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Show more loads the next 50 rows and goes once there are none", async ({ page, api }) => {
  const first = Array.from({ length: 50 }, (_, n) => stored(n + 1, { conversation_title: `Question ${n + 1}` }));
  api.reply(
    "GET /api/activity",
    ok({ rows: first, next: "cursor-1" }),
    failed(502, "QUERY_FAILED"),
    ok({ rows: [stored(51, { conversation_title: "Question 51" })], next: null }),
  );
  await page.goto("/");
  await openActivity(page);
  await expect(page.locator('[data-slot="activity-row"]')).toHaveCount(50);

  await page.getByRole("button", { name: "Show more" }).click();
  const problem = page.getByRole("alert");
  await expect(problem).toContainText("We can't show more of your activity right now");
  await problem.getByRole("button", { name: "Try again" }).click();

  await expect(page.locator('[data-slot="activity-row"]')).toHaveCount(51);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
  await expect(page.locator('[data-slot="activity-row"]').last().getByRole("link", { name: "Question 51" })).toBeVisible();
});
