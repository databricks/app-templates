import { expect, test } from '../fixtures';

test.describe('Chat Navigation and Error Handling', () => {
  test('shows error when navigating to non-existent chat', async ({
    adaContext,
  }) => {
    const { page } = adaContext;

    // Navigate to a chat that doesn't exist
    await page.goto('/chat/non-existent-chat-id-12345');

    // Should show error details
    await expect(
      page.getByText(
        /Chat not found or you do not have access|Failed to load chat/,
      ),
    ).toBeVisible();
  });
});
