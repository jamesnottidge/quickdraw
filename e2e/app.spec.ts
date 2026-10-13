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

/** Starts a run and reads its stream to the end, returning the run id. */
async function finishedRunId(page: Page, prompt: string): Promise<string> {
  const id = await page.evaluate(async (p) => {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: p }),
    });
    const reader = res.body!.getReader();
    while (!(await reader.read()).done) { /* drain */ }
    return res.headers.get('x-run-id');
  }, prompt);
  return id as string;
}

test.describe('run view', () => {
  test('a finished run shows the prompt, the timeline with its details, and the TLDR', async ({ page }) => {
    await page.goto('/');
    const id = await finishedRunId(page, 'legal rag chunking strategies');
    await page.goto(`/run/${id}`);

    await expect(page.getByText('legal rag chunking strategies').first()).toBeVisible();
    await expect(page.getByText(/Section-aware chunking helps legal RAG retrieve whole clauses/)).toBeVisible();

    const trigger = page.getByRole('button', { name: /Research complete/ }).first();
    if (!(await page.getByText('legal RAG chunking strategies retrieval quality').first().isVisible())) await trigger.click();
    for (const step of ['Plan', 'Search', 'Read', 'Write', 'Interactive view']) {
      await expect(page.getByText(step, { exact: true }).first()).toBeVisible();
    }
  });

  test('shows a clear message for a run that does not exist', async ({ page }) => {
    await page.goto('/run/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('alert').filter({ hasText: /doesn.t exist/ })).toBeVisible();
  });
});
