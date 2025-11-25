import { ChatPage } from '../pages/chat';
import { test, expect } from '../fixtures';
import { skipInWithDatabaseMode } from '../helpers';

test.describe('Ephemeral Mode (No Database)', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    skipInWithDatabaseMode(test);
    chatPage = new ChatPage(page);
    await chatPage.createNewChat();
  });

  test('Multi-turn conversation maintains context in ephemeral mode', async () => {
    // First message: establish context
    await chatPage.sendUserMessage('My favorite color is blue.');
    await chatPage.isGenerationComplete();

    const firstResponse = await chatPage.getRecentAssistantMessage();
    expect(firstResponse.content || firstResponse.reasoning).toBeTruthy();

    // Second message: reference the context from the first message
    await chatPage.sendUserMessage('What is my favorite color?');
    await chatPage.isGenerationComplete();

    const secondResponse = await chatPage.getRecentAssistantMessage();
    const responseText = (
      secondResponse.content || secondResponse.reasoning || ''
    ).toLowerCase();

    // The AI should remember that the user's favorite color is blue
    expect(responseText).toContain('blue');
  });

  test('Multiple exchanges work in ephemeral mode', async () => {
    // Send 3 messages and verify all get responses
    await chatPage.sendUserMessage('Hello');
    await chatPage.isGenerationComplete();
    const firstResponse = await chatPage.getRecentAssistantMessage();
    expect(firstResponse.content || firstResponse.reasoning).toBeTruthy();

    await chatPage.sendUserMessage('How are you?');
    await chatPage.isGenerationComplete();
    const secondResponse = await chatPage.getRecentAssistantMessage();
    expect(secondResponse.content || secondResponse.reasoning).toBeTruthy();

    await chatPage.sendUserMessage('Thank you');
    await chatPage.isGenerationComplete();
    const thirdResponse = await chatPage.getRecentAssistantMessage();
    expect(thirdResponse.content || thirdResponse.reasoning).toBeTruthy();
  });

  test('Message history is cleared on page refresh', async () => {
    // Send a message to establish context
    await chatPage.sendUserMessage('My name is Alice.');
    await chatPage.isGenerationComplete();

    // Refresh the page
    await chatPage.page.reload();
    await chatPage.createNewChat();

    // Ask about the previously established context
    await chatPage.sendUserMessage('What is my name?');
    await chatPage.isGenerationComplete();

    const response = await chatPage.getRecentAssistantMessage();
    const responseText = (
      response.content || response.reasoning || ''
    ).toLowerCase();

    // The AI should NOT remember the name after refresh
    expect(responseText).not.toContain('alice');
  });
});
