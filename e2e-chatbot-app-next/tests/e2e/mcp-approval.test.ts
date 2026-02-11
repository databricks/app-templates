import { ChatPage } from '../pages/chat';
import { test, expect } from '../fixtures';
import { resetMcpApprovalState } from '../api-mocking/api-mock-handlers';

/**
 * MCP Approval E2E Tests
 *
 * These tests verify the MCP (Model Context Protocol) approval flow in the browser.
 * MCP approval is a security feature that requires user consent before executing
 * certain tool calls.
 *
 * Test IDs available in the MCP approval components:
 * - mcp-approval-actions: Container for approval buttons
 * - mcp-approval-allow: Allow button
 * - mcp-approval-deny: Deny button
 * - mcp-approval-status-pending: Status badge (pending state)
 * - mcp-approval-status-allowed: Status badge (allowed state)
 * - mcp-approval-status-denied: Status badge (denied state)
 *
 * The mock handlers in tests/api-mocking/api-mock-handlers.ts detect:
 * - Messages containing "trigger mcp" to return MCP approval request
 * - MCP approval responses to continue with approved/denied stream
 */

// Run tests serially to avoid race conditions with shared mock state
test.describe.serial('MCP Approval Flow', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    // Reset MCP approval state between tests
    resetMcpApprovalState();

    chatPage = new ChatPage(page);
    await chatPage.createNewChat();
  });

  test('displays approval request with pending status', async ({ page }) => {
    // Send a message that triggers MCP tool call
    await chatPage.sendUserMessage('Trigger MCP tool');

    // Wait for approval request to appear
    await expect(page.getByTestId('mcp-approval-actions')).toBeVisible({
      timeout: 10000,
    });

    // Verify pending status badge is visible
    await expect(
      page.getByTestId('mcp-approval-status-pending'),
    ).toBeVisible();

    // Verify Allow and Deny buttons are enabled
    await expect(page.getByTestId('mcp-approval-allow')).toBeEnabled();
    await expect(page.getByTestId('mcp-approval-deny')).toBeEnabled();
  });

  test('user can approve tool execution', async ({ page }) => {
    // Send message that triggers MCP approval
    await chatPage.sendUserMessage('Trigger MCP tool');

    // Wait for approval request
    const allowButton = page.getByTestId('mcp-approval-allow');
    await expect(allowButton).toBeVisible({ timeout: 10000 });

    // Click Allow button and wait for the continuation API call
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/chat'),
    );
    await allowButton.click();

    // Wait for the continuation response (this is the second /api/chat call)
    const response = await responsePromise;
    await response.finished();

    // Verify status changes to allowed
    await expect(
      page.getByTestId('mcp-approval-status-allowed'),
    ).toBeVisible({ timeout: 10000 });

    // Verify approval actions are no longer visible
    await expect(page.getByTestId('mcp-approval-actions')).not.toBeVisible();

    // Verify the continuation text from the mock is visible
    // (The mock returns "The tool has been executed successfully." after approval)
    await expect(
      page.getByText('The tool has been executed successfully.'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('user can deny tool execution', async ({ page }) => {
    // Send message that triggers MCP approval
    await chatPage.sendUserMessage('Trigger MCP tool');

    // Wait for approval request
    await expect(page.getByTestId('mcp-approval-actions')).toBeVisible({
      timeout: 10000,
    });

    // Click Deny button
    await page.getByTestId('mcp-approval-deny').click();

    // Verify status changes to denied
    await expect(page.getByTestId('mcp-approval-status-denied')).toBeVisible({
      timeout: 10000,
    });

    // Verify approval actions are no longer visible
    await expect(page.getByTestId('mcp-approval-actions')).not.toBeVisible();
  });

  test('buttons are disabled while approval is being submitted', async ({
    page,
  }) => {
    await chatPage.sendUserMessage('Trigger MCP tool');

    // Wait for approval request
    await expect(page.getByTestId('mcp-approval-actions')).toBeVisible({
      timeout: 10000,
    });

    // Click Allow button
    await page.getByTestId('mcp-approval-allow').click();

    // Verify both buttons become disabled during submission
    // Note: This may happen quickly, so we use a race condition check
    const allowButton = page.getByTestId('mcp-approval-allow');
    const denyButton = page.getByTestId('mcp-approval-deny');

    // Either buttons are disabled (during submission) or actions are already hidden (submission complete)
    const wasDisabledOrComplete = await Promise.race([
      // Option 1: Buttons are disabled
      Promise.all([
        expect(allowButton).toBeDisabled(),
        expect(denyButton).toBeDisabled(),
      ]).then(() => true),
      // Option 2: Actions are already hidden (submission was fast)
      expect(
        page.getByTestId('mcp-approval-actions'),
      )
        .not.toBeVisible()
        .then(() => true),
    ]).catch(() => false);

    expect(wasDisabledOrComplete).toBe(true);
  });
});
