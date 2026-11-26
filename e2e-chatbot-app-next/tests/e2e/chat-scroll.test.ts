import { expect, test } from '../fixtures';
import { ChatPage } from '../pages/chat';

// While a reply streams, the conversation follows it to the bottom, and stops
// following once the user scrolls up (#252). Growth is simulated in the DOM because
// the mock stream finishes before a reply could overflow the view.
test('follows a growing reply, and stops after the user scrolls up', async ({
  adaContext,
}) => {
  const page = adaContext.page;
  const chatPage = new ChatPage(page);
  await chatPage.createNewChat();
  await chatPage.sendMultipleMessages(3, (i) => `filling message #${i}`);
  await chatPage.waitForScrollToBottom();

  const gap = () =>
    chatPage.scrollContainer.evaluate((el) =>
      Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    );
  // Grow the last message the way a streamed reply does: append a chunk inside the
  // content that use-stick-to-bottom observes, then give it a moment to follow.
  const grow = (px: number) =>
    page.evaluate((h) => {
      const scroller = document.querySelector(
        '.overflow-y-scroll',
      ) as HTMLElement;
      const content = scroller.firstElementChild as HTMLElement;
      const last = content.lastElementChild?.previousElementSibling ?? content;
      const chunk = document.createElement('p');
      chunk.style.height = `${h}px`;
      chunk.textContent = 'streamed chunk';
      last.appendChild(chunk);
    }, px);

  const following: number[] = [];
  for (let i = 0; i < 8; i++) {
    await grow(120);
    await page.waitForTimeout(400);
    following.push(await gap());
  }
  expect(Math.max(...following)).toBeLessThan(60); // well under one 120px chunk: it keeps up

  // The user scrolls up to read; further growth must not pull them back down.
  await chatPage.scrollContainer.evaluate((el) => el.scrollBy(0, -400));
  await page.waitForTimeout(400);
  const afterScrollUp = await gap();
  for (let i = 0; i < 4; i++) {
    await grow(120);
    await page.waitForTimeout(300);
  }
  const afterGrowth = await gap();
  expect(afterGrowth).toBeGreaterThan(afterScrollUp);
  await expect(chatPage.scrollToBottomButton).toBeVisible();

  await chatPage.scrollToBottomButton.click();
  await chatPage.waitForScrollToBottom();
  await expect(chatPage.scrollToBottomButton).not.toBeVisible();
});
