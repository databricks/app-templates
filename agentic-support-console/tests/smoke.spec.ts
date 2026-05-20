import { test, expect } from '@playwright/test';

test('case queue page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cases' })).toBeVisible();
  await expect(page.getByText('Agentic Support')).toBeVisible();
});

test('analytics page loads', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
});
