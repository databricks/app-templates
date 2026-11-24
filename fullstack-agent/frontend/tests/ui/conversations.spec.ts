import type { Locator, Page, Route } from "@playwright/test";
import { PRODUCT_NAME } from "../../src/config/brand";
import {
  checkScreen,
  expect,
  failed,
  isPhone,
  noContent,
  ok,
  test,
  USER_MESSAGE,
  WEBKIT_TABS_TO_FORM_CONTROLS_ONLY,
} from "./fixtures";

const NOW = new Date(2026, 9, 10, 14, 0);
const HOUR_MS = 3_600_000;

const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS).toISOString();

const SESSIONS = [
  { id: "c1", title: "Missing record", last_activity_time: hoursBefore(1) },
  { id: "c2", title: "Reference list", last_activity_time: hoursBefore(20) },
  { id: "c3", title: "Archive a record", last_activity_time: new Date(2026, 9, 2, 9, 15).toISOString() },
];

const REFERENCE = {
  id: "c2",
  title: "Reference list",
  messages: [
    { role: "user", content: "What is in the reference list?" },
    { role: "assistant", content: "The reference list has 12 entries, 3 of them new." },
  ],
  runs: [],
  running: null,
};

const RENAME_FAILED = "We couldn't rename the conversation. Try again in a few minutes.";
const DELETE_FAILED = "We couldn't delete the conversation. Try again in a few minutes.";
const DELETE_ANSWERING = "We can't delete a conversation while it's being answered. Try again when the answer is done.";

const conversations = (page: Page) => page.getByRole("navigation", { name: "Conversations" });
const more = (page: Page, title: string) => conversations(page).getByRole("button", { name: `More actions for ${title}` });
const titleField = (page: Page, title: string) => conversations(page).getByRole("textbox", { name: `New title for ${title}` });
const deleteDialog = (page: Page) => page.getByRole("dialog", { name: "Delete this conversation?" });
const titles = (page: Page) => conversations(page).locator('[data-slot="aui_thread-list-item-title"]');

async function showConversations(page: Page): Promise<void> {
  await page.goto("/");
  if (isPhone()) await page.getByRole("button", { name: "Conversation list" }).click();
  await expect(titles(page)).toHaveCount(SESSIONS.length);
}

async function choose(page: Page, title: string, action: "Rename" | "Delete"): Promise<void> {
  await more(page, title).click();
  await page.getByRole("menuitem", { name: action }).click();
}

async function deleteConfirmed(page: Page, title: string): Promise<void> {
  await choose(page, title, "Delete");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
}

/** True if focus is inside locator. */
function hasFocus(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.contains(document.activeElement));
}

test.beforeEach(async ({ page, api }) => {
  await page.clock.setFixedTime(NOW);
  api.reply("GET /api/sessions", ok(SESSIONS));
});

test("Rename edits the title in place, and Enter saves it", async ({ page, api }) => {
  api.reply("PATCH /api/sessions/c2", ok({ ...SESSIONS[1], title: "Saved references" }));
  await showConversations(page);
  await choose(page, "Reference list", "Rename");

  const field = titleField(page, "Reference list");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Reference list");
  await expect(field).toHaveAttribute("maxlength", "120");
  await field.fill("  Saved references ");
  await field.press("Enter");

  await expect(conversations(page).getByRole("link", { name: "Saved references" })).toBeFocused();
  await expect.poll(() => api.posted("PATCH /api/sessions/c2")).toEqual([{ title: "Saved references" }]);
  await expect(titles(page)).toHaveText(["Missing record", "Saved references", "Archive a record"]);
});

test("Escape, or a blank or unchanged title keeps the old title, and leaving the field saves it", async ({ page, api }) => {
  api.reply("PATCH /api/sessions/c2", ok({ ...SESSIONS[1], title: "Something else" }));
  await showConversations(page);
  const link = conversations(page).getByRole("link", { name: "Reference list" });

  await choose(page, "Reference list", "Rename");
  await titleField(page, "Reference list").fill("Something else");
  await page.keyboard.press("Escape");
  await expect(link).toBeFocused();

  for (const value of ["   ", "Reference list"]) {
    await choose(page, "Reference list", "Rename");
    await titleField(page, "Reference list").fill(value);
    await page.keyboard.press("Enter");
    await expect(link).toBeFocused();
  }

  await expect(titles(page)).toHaveText(SESSIONS.map((session) => session.title));
  expect(api.calls).not.toContain("PATCH /api/sessions/c2");

  await choose(page, "Reference list", "Rename");
  await titleField(page, "Reference list").fill("Something else");
  await conversations(page).getByRole("heading", { name: "Conversations" }).click();
  await expect(titleField(page, "Reference list")).toHaveCount(0);
  await expect(titles(page)).toHaveText(["Missing record", "Something else", "Archive a record"]);
  await expect.poll(() => api.posted("PATCH /api/sessions/c2")).toEqual([{ title: "Something else" }]);
});

test("Delete asks first, then the conversation is gone and focus moves to the next one", async ({ page, api }) => {
  api.reply("DELETE /api/sessions/c2", noContent);
  api.reply("DELETE /api/sessions/c3", noContent);
  await showConversations(page);
  await choose(page, "Reference list", "Delete");

  const dialog = deleteDialog(page);
  await expect(dialog).toContainText(
    `"Reference list" leaves your conversation list. ${PRODUCT_NAME} keeps its records of the conversation for the time its retention policy sets.`,
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await checkScreen(page, "delete-dialog");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(dialog).toBeHidden();
  await expect(titles(page)).toHaveText(["Missing record", "Archive a record"]);
  await expect(conversations(page).getByRole("link", { name: /Archive a record/ })).toBeFocused();
  await expect.poll(() => api.calls).toContain("DELETE /api/sessions/c2");

  await deleteConfirmed(page, "Archive a record");
  await expect(titles(page)).toHaveText(["Missing record"]);
  await expect(conversations(page).getByRole("button", { name: "New conversation" })).toBeFocused();
});

test("Cancel or Escape in the delete dialog keeps the conversation and returns to its menu button", async ({
  page,
  api,
}) => {
  await showConversations(page);
  const button = more(page, "Reference list");

  await choose(page, "Reference list", "Delete");
  await deleteDialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(button).toBeFocused();

  await choose(page, "Reference list", "Delete");
  await expect(deleteDialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteDialog(page)).toBeHidden();
  await expect(button).toBeFocused();

  await expect(titles(page)).toHaveText(SESSIONS.map((session) => session.title));
  expect(api.calls).not.toContain("DELETE /api/sessions/c2");
});

test("after a server error only that row goes back, and the list says what failed", async ({ page, api }) => {
  api.reply("DELETE /api/sessions/c3", noContent);
  api.reply("DELETE /api/sessions/c1", failed(503));
  const held: Route[] = [];
  await page.route("**/api/sessions/c2", (route) => {
    if (route.request().method() === "PATCH") held.push(route);
    else return route.fallback();
  });
  await showConversations(page);

  await choose(page, "Reference list", "Rename");
  await titleField(page, "Reference list").fill("Saved references");
  await page.keyboard.press("Enter");
  await expect.poll(() => held.length).toBe(1);
  await expect(titleField(page, "Saved references")).toHaveValue("Saved references");
  await deleteConfirmed(page, "Archive a record");
  await expect(titles(page)).toHaveText(["Missing record"]);

  await held[0].fulfill(failed(502));
  await expect(titles(page)).toHaveText(["Missing record", "Reference list"]);
  const alert = conversations(page).getByRole("alert");
  await expect(alert).toHaveText(RENAME_FAILED);

  await deleteConfirmed(page, "Missing record");
  await expect(alert).toHaveText(DELETE_FAILED);
  await expect(titles(page)).toHaveText(["Missing record", "Reference list"]);
  await checkScreen(page, "conversation-list-error");
});

test("a conversation still being answered can't be deleted, and the list says so", async ({ page, api }) => {
  api.reply("DELETE /api/sessions/c2", failed(409));
  await showConversations(page);

  await deleteConfirmed(page, "Reference list");

  await expect(conversations(page).getByRole("alert")).toHaveText(DELETE_ANSWERING);
  await expect(titles(page)).toHaveText(SESSIONS.map((session) => session.title));
});

test("deleting the open conversation opens a new one", async ({ page, api }) => {
  api.reply("GET /api/sessions/c2", ok(REFERENCE));
  api.reply("DELETE /api/sessions/c2", noContent);
  await page.goto("/#/assistant/c2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reference list");
  if (isPhone()) await page.getByRole("button", { name: "Conversation list" }).click();

  await deleteConfirmed(page, "Reference list");

  await expect(page).toHaveURL(/#\/assistant$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New conversation");
  await expect(page.locator(USER_MESSAGE)).toHaveCount(0);
});

test("rename and delete work with the keyboard alone, and the drawer stays open around them", async ({
  page,
  api,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone-webkit", WEBKIT_TABS_TO_FORM_CONTROLS_ONLY);
  api.reply("PATCH /api/sessions/c1", ok({ ...SESSIONS[0], title: "Lost record" }));
  api.reply("DELETE /api/sessions/c1", noContent);
  await page.goto("/");
  const list = conversations(page);
  if (isPhone()) {
    await page.getByRole("button", { name: "Conversation list" }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(titles(page)).toHaveCount(SESSIONS.length);
  const stillOpen = async () => {
    await expect(list).toBeVisible();
  };

  const button = more(page, "Missing record");
  await list.getByRole("link", { name: "Missing record" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  const rename = page.getByRole("menuitem", { name: "Rename" });
  await expect(rename).toBeFocused();
  await checkScreen(page, "conversation-menu");
  await page.keyboard.press("Tab");
  await expect(rename).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(button).toBeFocused();
  await stillOpen();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const field = titleField(page, "Missing record");
  await expect(field).toBeFocused();
  await checkScreen(page, "conversation-rename");
  await page.keyboard.press("Escape");
  await expect(list.getByRole("link", { name: "Missing record" })).toBeFocused();
  await stillOpen();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(field).toHaveCount(0);
  await stillOpen();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Lost record");
  await page.keyboard.press("Enter");
  await expect(list.getByRole("link", { name: "Lost record" })).toBeFocused();

  const remove = page.getByRole("menuitem", { name: "Delete" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = deleteDialog(page);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await checkScreen(page, "conversation-delete");
  for (let presses = 0; presses < 3; presses++) {
    await page.keyboard.press("Tab");
    expect(await hasFocus(dialog)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more(page, "Lost record")).toBeFocused();
  await stillOpen();

  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(titles(page)).toHaveText(["Reference list", "Archive a record"]);
  await expect(list.getByRole("link", { name: "Reference list" })).toBeFocused();
  await stillOpen();
  await expect.poll(() => api.calls).toContain("DELETE /api/sessions/c1");
});
