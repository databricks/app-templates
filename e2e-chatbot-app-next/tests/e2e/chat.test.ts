import { ChatPage } from '../pages/chat';
import { test, expect } from '../fixtures';

test.describe('Chat activity', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.createNewChat();
  });

  test('Send a user message and receive response', async () => {
    await chatPage.sendUserMessage('Hello');
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content || assistantMessage.reasoning).toBeTruthy();
  });

  test('Redirect to /chat/:id after submitting message', async () => {
    await chatPage.sendUserMessage('Hello');
    await chatPage.isGenerationComplete();
    await chatPage.hasChatIdInUrl();
  });

  test('Send a user message from suggestion', async () => {
    await chatPage.sendUserMessageFromSuggestion();
    await chatPage.isGenerationComplete();
    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content || '').not.toEqual('');
  });

  test('Toggle between send/stop button based on activity', async () => {
    await expect(chatPage.sendButton).toBeVisible();
    await expect(chatPage.sendButton).toBeDisabled();

    await chatPage.sendUserMessage('Hello');

    await expect(chatPage.sendButton).not.toBeVisible();
    await expect(chatPage.stopButton).toBeVisible();

    await chatPage.isGenerationComplete();

    await expect(chatPage.stopButton).not.toBeVisible();
    await expect(chatPage.sendButton).toBeVisible();
  });

  test('Stop generation during submission', async () => {
    await chatPage.sendUserMessage('Hello');
    await expect(chatPage.stopButton).toBeVisible();
    await chatPage.stopButton.click();
    await expect(chatPage.sendButton).toBeVisible();
  });

  test('Edit user message and resubmit', async () => {
    await chatPage.sendUserMessage('Hello');
    await chatPage.isGenerationComplete();

    const userMessage = await chatPage.getRecentUserMessage();

    await Promise.all([
      chatPage.isGenerationComplete(),
      userMessage.edit('Hello again'),
    ]);

    const updatedAssistantMessage = await chatPage.getRecentAssistantMessage();
    expect(
      updatedAssistantMessage.content || updatedAssistantMessage.reasoning,
    ).toBeTruthy();
  });

  test('Hide suggested actions after sending message', async () => {
    await chatPage.isElementVisible('suggested-actions');
    await chatPage.sendUserMessageFromSuggestion();
    await chatPage.isElementNotVisible('suggested-actions');
  });

  test('Call tool (mocked stream still returns content)', async () => {
    await chatPage.sendUserMessage("What's the weather in sf?");
    await chatPage.isGenerationComplete();
    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content || '').not.toEqual('');
  });

  test('Create message from url query', async ({ page }) => {
    await page.goto('/?query=Why is the sky blue?');

    await chatPage.isGenerationComplete();

    const userMessage = await chatPage.getRecentUserMessage();
    expect(userMessage.content).toBe('Why is the sky blue?');

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content).toContain("It's just blue duh!");
  });

  test('auto-scrolls to bottom after submitting new messages', async () => {
    test.fixme();
    await chatPage.sendMultipleMessages(5, (i) => `filling message #${i}`);
    await chatPage.waitForScrollToBottom();
  });

  test('scroll button appears when user scrolls up, hides on click', async () => {
    test.fixme();
    await chatPage.sendMultipleMessages(5, (i) => `filling message #${i}`);
    await expect(chatPage.scrollToBottomButton).not.toBeVisible();

    await chatPage.scrollToTop();
    await expect(chatPage.scrollToBottomButton).toBeVisible();

    await chatPage.scrollToBottomButton.click();
    await chatPage.waitForScrollToBottom();
    await expect(chatPage.scrollToBottomButton).not.toBeVisible();
  });
});
