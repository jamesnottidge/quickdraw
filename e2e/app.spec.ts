import { test, expect, type Page } from '@playwright/test';

/** Starts a run from the page's own session and returns its id without reading the stream. */
async function startRunId(page: Page, prompt: string): Promise<string> {
  const id = await page.evaluate(async (p) => {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: p }),
    });
    return res.headers.get('x-run-id');
  }, prompt);
  expect(id).toBeTruthy();
  return id as string;
}

test.describe('app shell', () => {
  test('lists this browser\'s sessions in the sidebar and opens one', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'New research' })).toBeVisible();
    const id = await startRunId(page, 'sidebar session test');
    await page.reload();
    const item = page.getByRole('link', { name: /sidebar session test/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/run/${id}$`));
  });

  test('does not show another browser\'s sessions', async ({ browser, page }) => {
    await page.goto('/');
    await startRunId(page, 'private session of browser one');
    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto('/');
    await expect(page2.getByRole('link', { name: /private session of browser one/ })).toHaveCount(0);
    await other.close();
  });

  test('toggles the theme', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const before = await html.evaluate((el) => el.classList.contains('dark'));
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(!before);
  });
});
