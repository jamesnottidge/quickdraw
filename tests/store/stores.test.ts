import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/store/db';
import { seedRun, testDb } from '../helpers/db';
import { upsertSession } from '@/lib/store/sessions';
import { createRun, finishRun, getRun } from '@/lib/store/runs';
import { insertEvent, listEvents } from '@/lib/store/events';
import { insertModelCall, sumRunCost } from '@/lib/store/modelCalls';
import { pruneOldPages, upsertPage } from '@/lib/store/pages';
import { countReconnects, insertReconnect } from '@/lib/store/reconnects';
import type { RunEvent } from '@/lib/events/schema';

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

describe('sessions', () => {
  it('returns the same id for the same device+ip and a new one for a new ip', async () => {
    const a = await upsertSession(db, { deviceId: 'd1', ipHash: 'h1', userAgent: 'UA' });
    const b = await upsertSession(db, { deviceId: 'd1', ipHash: 'h1', userAgent: 'UA2' });
    const c = await upsertSession(db, { deviceId: 'd1', ipHash: 'h2' });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe('runs', () => {
  it('creates, reads (numbers, not strings) and finishes a run', async () => {
    const sessionId = await upsertSession(db, { deviceId: 'd', ipHash: 'h' });
    const id = randomUUID();
    await createRun(db, {
      id, sessionId, prompt: 'why?', config: { models: { planner: 'm' } },
      reservedUsd: 0.15, reservedSearches: 8, ledgerDay: '2026-10-13',
    });
    const run = await getRun(db, id);
    expect(run).toMatchObject({
      id, status: 'running', prompt: 'why?', reserved_usd: 0.15, reserved_searches: 8,
      ledger_day: '2026-10-13', settled: false, cost_usd: 0, finished_at: null,
    });
    expect(run!.config).toEqual({ models: { planner: 'm' } });
    await finishRun(db, id, { status: 'failed', costUsd: 0.0123, error: 'boom' });
    const done = await getRun(db, id);
    expect(done).toMatchObject({ status: 'failed', cost_usd: 0.0123, error: 'boom' });
    expect(done!.finished_at).not.toBeNull();
  });

  it('returns null for an unknown run', async () => {
    expect(await getRun(db, randomUUID())).toBeNull();
  });
});

const ev = (runId: string, seq: number, text: string): RunEvent => ({ runId, seq, ts: 1_700_000_000_000 + seq, type: 'report_delta', text });

describe('events', () => {
  it('stores events and lists them in seq order, optionally after a seq', async () => {
    const { runId } = await seedRun(db);
    await insertEvent(db, ev(runId, 2, 'b'));
    await insertEvent(db, ev(runId, 1, 'a'));
    await insertEvent(db, ev(runId, 3, 'c'));
    expect((await listEvents(db, runId)).map((e) => (e as any).text)).toEqual(['a', 'b', 'c']);
    expect((await listEvents(db, runId, 2)).map((e) => e.seq)).toEqual([3]);
    expect((await listEvents(db, runId))[0]).toEqual(ev(runId, 1, 'a'));
  });

  it('refuses a duplicate (run, seq)', async () => {
    const { runId } = await seedRun(db);
    await insertEvent(db, ev(runId, 1, 'a'));
    await expect(insertEvent(db, ev(runId, 1, 'again'))).rejects.toThrow();
  });
});

describe('model calls', () => {
  const rec = (cost: number, response: unknown = { ok: true }) => ({
    stage: 'summarize' as const, model: 'scaledown/summarize', request: { a: 1 }, response,
    httpStatus: 200, latencyMs: 12, inputTokens: 100, outputTokens: 20, costUsd: cost,
  });

  it('stores calls and sums cost per run', async () => {
    const { runId } = await seedRun(db);
    const other = await seedRun(db, { deviceId: 'x', ipHash: 'y' });
    await insertModelCall(db, runId, rec(0.001));
    await insertModelCall(db, runId, rec(0.0025));
    await insertModelCall(db, other.runId, rec(9));
    expect(await sumRunCost(db, runId)).toBeCloseTo(0.0035, 8);
    expect(await sumRunCost(db, randomUUID())).toBe(0);
  });

  it('REVIEW FOCUS: NUL characters in a response do not make persistence fail', async () => {
    const { runId } = await seedRun(db);
    await expect(insertModelCall(db, runId, rec(0, { content: 'bad\u0000byte' }))).resolves.toBeUndefined();
    const [row] = await db.query<{ response: any }>('select response from model_calls where run_id = $1', [runId]);
    expect(row.response.content).toBe('badbyte');
  });
});

describe('pages', () => {
  it('upserts per (run,url) and strips NUL from markdown', async () => {
    const { runId } = await seedRun(db);
    await upsertPage(db, runId, { url: 'https://a.test/', fetchStatus: 'failed', error: 'HTTP 500' });
    await upsertPage(db, runId, { url: 'https://a.test/', fetchStatus: 'ok', contentType: 'text/html', markdown: 'hi\u0000there', bytes: 9 });
    const rows = await db.query<any>('select * from pages where run_id = $1', [runId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fetch_status: 'ok', markdown: 'hithere', bytes: 9, error: null });
  });

  it('prunes only pages older than the retention window', async () => {
    const { runId } = await seedRun(db);
    await upsertPage(db, runId, { url: 'https://old.test/', fetchStatus: 'ok', markdown: 'x' });
    await upsertPage(db, runId, { url: 'https://new.test/', fetchStatus: 'ok', markdown: 'y' });
    await db.query(`update pages set created_at = now() - interval '100 days' where url = 'https://old.test/'`);
    expect(await pruneOldPages(db, 90)).toBe(1);
    const left = await db.query<{ url: string }>('select url from pages');
    expect(left.map((r) => r.url)).toEqual(['https://new.test/']);
  });
});

describe('reconnects', () => {
  it('counts reconnects and those that happened while the run was active', async () => {
    const { runId, sessionId } = await seedRun(db);
    await insertReconnect(db, { runId, sessionId, runActive: true });
    await insertReconnect(db, { runId, sessionId, runActive: true });
    await insertReconnect(db, { runId, sessionId: null, runActive: false });
    expect(await countReconnects(db)).toEqual({ total: 3, whileActive: 2 });
  });
});
