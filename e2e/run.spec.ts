import { test, expect, type Page } from '@playwright/test';

const PROMPT = 'legal rag chunking strategies';

async function startRun(page: Page, prompt = PROMPT) {
  await page.goto('/');
  await page.getByRole('textbox').fill(prompt);
  await page.getByRole('button', { name: 'Run research' }).click();
}

test('streams a run live, shows the report canvas and TLDR, and replays after a reload', async ({ page }) => {
  await startRun(page);

  // live progress appears before the run finishes
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  await expect(page.getByText('legal RAG chunking strategies retrieval quality').first()).toBeVisible();
  await expect(page.getByText(/^vague · 0\.4$/).first()).toBeVisible(); // the "ai" query scored vague
  await expect(page.getByText('HTTP 403')).toBeVisible(); // a page that could not be fetched

  // finished: canvas + TLDR
  await expect(page.getByRole('heading', { name: 'Chunking for legal RAG' })).toBeVisible();
  await expect(page.getByText(/Section-aware chunking helps legal RAG retrieve whole clauses/)).toBeVisible();
  await expect(page.getByText(/^Done · model cost/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Shared guide/ })).toBeVisible(); // sources list in the report

  expect(page.url()).toMatch(/\/run\/[0-9a-f-]{36}$/);

  // replay from stored events
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chunking for legal RAG' })).toBeVisible();
  await expect(page.getByText(/Section-aware chunking helps legal RAG retrieve whole clauses/)).toBeVisible();
});

test('blocks a device after its daily quota with a clear message', async ({ page }) => {
  for (let i = 0; i < 2; i++) {
    await startRun(page, `${PROMPT} ${i}`);
    await expect(page.getByText(/^Done · model cost/)).toBeVisible();
  }
  await page.getByRole('button', { name: 'New research' }).click();
  await page.getByRole('textbox').fill(`${PROMPT} third`);
  await page.getByRole('button', { name: 'Run research' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/tomorrow/i); // not getByRole: Next's route announcer is also role=alert
});

test('records a reconnect when an in-progress run is reopened', async ({ page, request }) => {
  await page.goto('/');
  // start a run from the page but do not read the stream
  const runId = await page.evaluate(async () => {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'reconnect test run' }),
    });
    return res.headers.get('x-run-id');
  });
  expect(runId).toBeTruthy();

  const replay = await request.get(`/api/run/${runId}`);
  expect((await replay.json()).active).toBe(true);

  const stats = await request.get('/api/stats', { headers: { authorization: 'Bearer e2e-secret' } });
  expect((await stats.json()).reconnects.whileActive).toBeGreaterThanOrEqual(1);

  const denied = await request.get('/api/stats');
  expect(denied.status()).toBe(401);
});
