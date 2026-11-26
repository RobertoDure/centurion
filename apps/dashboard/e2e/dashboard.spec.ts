import { expect, test } from '@playwright/test';

/**
 * Smoke test for the dashboard (T7.7): create a rule, dry-run it in the test
 * panel, then observe the live SSE flag stream and the flag history.
 */
test('creates a rule, shows the test verdict, and surfaces a live flag', async ({ page }) => {
  const ruleName = `E2E rule ${Date.now()}`;

  await page.goto('/rules/new');
  await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible();

  await page.getByLabel('Name').fill(ruleName);
  await page.getByRole('button', { name: /2\. Question/ }).click();
  await page
    .getByLabel('Instructions')
    .fill('Does this log describe a payment failure that needs follow-up?');
  await page.getByText('Noul', { exact: true }).click();
  await page.getByRole('button', { name: /3\. Condition/ }).click();
  await page.getByLabel('Threshold (0 to 1)').fill('0.5');

  // T7.3 test panel: a dry run returns a typed answer and a verdict.
  await page.getByRole('button', { name: /5\. Test/ }).click();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByTestId('rule-test-result')).toContainText('TRIGGERED');

  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await expect(page.getByText(ruleName)).toBeVisible();

  // T7.5 live feed: a flag.created event appears on the SSE stream.
  await page.goto('/live');
  await expect(page.getByRole('heading', { name: 'Live feed' })).toBeVisible();
  await expect(page.locator('[data-testid="live-flags"] li').first()).toBeVisible({
    timeout: 30_000,
  });

  // T7.5 flags page: history rows expose the answer details.
  await page.goto('/flags');
  await expect(page.getByRole('heading', { name: 'Flags' })).toBeVisible();
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  await firstRow.getByRole('button', { name: 'Details' }).click();
  const drawer = page.getByRole('dialog', { name: 'Flag details' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Answer' })).toBeVisible();
});
