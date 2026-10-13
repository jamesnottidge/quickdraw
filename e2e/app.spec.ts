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

test.describe('home', () => {
  test('shows the prompt, fills it from a suggestion, and streams a run live', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /What do you want researched/i })).toBeVisible();

    const suggestion = page.getByRole('button', { name: /chunking strategies affect retrieval quality/i });
    await suggestion.click();
    const box = page.getByRole('textbox');
    await expect(box).toHaveValue(/chunking strategies/);

    await page.getByRole('button', { name: 'Send' }).click();

    // live progress arrives before the run finishes
    await expect(page.getByText('Researching…').first()).toBeVisible();
    await expect(page.getByText(/Section-aware chunking helps legal RAG retrieve whole clauses/)).toBeVisible();
    await expect(page).toHaveURL(/\/run\/[0-9a-f-]{36}$/);

    // the new session shows up in the sidebar
    await expect(page.getByRole('link', { name: /chunking strategies affect retrieval quality/i }).first()).toBeVisible();
  });

  test('will not submit a prompt that is too short', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('hi');
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  test('blocks a device after its daily quota with a clear message', async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.goto('/');
      await page.getByRole('textbox').fill(`quota test run number ${i}`);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByText(/Research complete/).first()).toBeVisible({ timeout: 30_000 });
    }
    await page.goto('/');
    await page.getByRole('textbox').fill('quota test run number three');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /tomorrow/i })).toBeVisible();
  });
});

const REPORT_CANVAS = 'Report canvas';

async function startAndWaitForCanvas(page: Page, prompt: string) {
  await page.goto('/');
  await page.getByRole('textbox').fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  return page.getByRole('complementary', { name: REPORT_CANVAS });
}

test.describe('canvas', () => {
  test('stays closed while the report is written, opens by itself when ready, and can be collapsed and reopened', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'canvas behaviour test run');
    await expect(page.getByText('Researching…').first()).toBeVisible();
    await expect(canvas).toHaveCount(0); // not open during planning, search and reading

    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(canvas.getByRole('heading', { name: 'Chunking for legal RAG' })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse canvas' }).click();
    await expect(canvas).toHaveCount(0);
    await page.getByRole('button', { name: 'Open report' }).click();
    await expect(canvas).toBeVisible();
  });

  test('citation markers become hover previews and sources become cards', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'citation hover test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    const sources = canvas.getByRole('region', { name: 'Sources' });
    await expect(sources.getByRole('link')).toHaveCount(3);

    const chip = canvas.locator('article').getByText('1', { exact: true }).first();
    await chip.hover();
    await expect(page.getByText('example.test').first()).toBeVisible();
  });

  test('the interactive view runs in a sandbox that cannot reach the page, cookies or network', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'sandbox security test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.getByRole('tab', { name: /Interactive view/ }).click();

    const iframe = canvas.locator('iframe[title="Interactive view"]');
    await expect(iframe).toBeVisible({ timeout: 30_000 });
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

    const frame = page.frameLocator('iframe[title="Interactive view"]');
    await frame.getByRole('button', { name: 'Show details' }).click(); // it is interactive
    await expect(frame.getByText(/Section-aware chunking keeps clauses/)).toBeVisible();
    await expect(frame.locator('#probe')).toHaveText('{"cookie":"blocked","parent":"blocked","fetch":"blocked"}');
  });

  test('REVIEW FOCUS: a run recorded before artifacts existed still opens, with plain markers and no interactive content', async ({ page }) => {
    const id = '11111111-1111-4111-8111-111111111111';
    const events = [
      { runId: id, seq: 1, ts: 1, type: 'run_started', prompt: 'old run' },
      { runId: id, seq: 2, ts: 2, type: 'report_done', text: '# Old report\n\nA claim [1].\n\n## Sources\n\n1. [Alpha](https://a.test)\n' },
      { runId: id, seq: 3, ts: 3, type: 'run_finished', costUsd: 0.01 },
    ];
    await page.route(`**/api/run/${id}*`, (route) =>
      route.fulfill({ json: { run: { id, prompt: 'old run', status: 'finished' }, events, active: false } }),
    );
    await page.goto(`/run/${id}`);
    const canvas = page.getByRole('complementary', { name: REPORT_CANVAS });
    await expect(canvas.getByRole('heading', { name: 'Old report' })).toBeVisible();
    await expect(canvas.getByText('A claim [1].')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Alpha' })).toBeVisible(); // the markdown Sources list is kept
    await canvas.getByRole('tab', { name: /Interactive view/ }).click();
    await expect(canvas.getByText(/No interactive view for this run/)).toBeVisible();
  });
});

test.describe('canvas on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('opens the report in a full-height sheet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('mobile canvas test run');
    await page.getByRole('button', { name: 'Send' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Chunking for legal RAG' })).toBeVisible({ timeout: 30_000 });
  });
});
