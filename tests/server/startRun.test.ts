import { describe, it, expect } from 'vitest';
import { startRun } from '@/lib/server/startRun';
import { createFakeDeps } from '@/lib/pipeline/fakes';
import { loadConfig } from '@/lib/config';
import { getLedger, utcDay } from '@/lib/limits/budget';
import { getRun } from '@/lib/store/runs';
import { listEvents } from '@/lib/store/events';
import type { Identity } from '@/lib/identity';
import type { RunEvent } from '@/lib/events/schema';
import { seedRun, testDb } from '../helpers/db';

const identity: Identity = { deviceId: 'dev-A', ipHash: 'ip-A', userAgent: 'UA', isNewDevice: false };
const buildDeps = (opts: Parameters<typeof createFakeDeps>[0] = {}) => ({ signal, meter }: any) =>
  createFakeDeps({ ...opts, signal, meter });

async function collect(started: any): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const ev of started.channel) out.push(ev);
  return out;
}

describe('startRun', () => {
  it('streams contiguous events, persists the same events, finishes the run and settles the ledger', async () => {
    const db = await testDb();
    const config = loadConfig({});
    const started = await startRun({ db, config, identity, prompt: 'legal rag chunking', buildDeps: buildDeps() });
    if (!started.ok) throw new Error('expected ok');
    const events = await collect(started);
    await started.done;

    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0].type).toBe('run_started');
    expect(events.at(-1)!.type).toBe('run_finished');
    expect(await listEvents(db, started.runId)).toEqual(events);

    const run = await getRun(db, started.runId);
    expect(run).toMatchObject({ status: 'finished', settled: true, error: null });
    expect(run!.cost_usd).toBeGreaterThan(0);
    expect((run!.config as any).prompts.planner).toContain('plan web searches');

    const searches = events.filter((e) => e.type === 'search_started').length;
    const ledger = await getLedger(db, utcDay(new Date()));
    expect(ledger).toMatchObject({ reservedUsd: 0, searchReserved: 0, searchUsed: searches });
    expect(ledger!.actualUsd).toBeCloseTo(run!.cost_usd, 6);
  });

  it('REVIEW FOCUS: a visitor who closes the tab (never reads the channel) still gets a completed, persisted, settled run', async () => {
    const db = await testDb();
    const started = await startRun({ db, config: loadConfig({}), identity, prompt: 'abandoned run', buildDeps: buildDeps() });
    if (!started.ok) throw new Error('expected ok');
    await started.done; // nobody consumed the channel
    const run = await getRun(db, started.runId);
    expect(run).toMatchObject({ status: 'finished', settled: true });
    const stored = await listEvents(db, started.runId);
    expect(stored.length).toBeGreaterThan(8);
    expect(stored.at(-1)!.type).toBe('run_finished');
    expect((await getLedger(db, utcDay(new Date())))!.reservedUsd).toBe(0);
  });

  it('records a pipeline crash as run_failed and still releases the reservation', async () => {
    const db = await testDb();
    const started = await startRun({
      db, config: loadConfig({}), identity, prompt: 'will crash',
      buildDeps: () => { throw new Error('missing TAVILY_API_KEY'); },
    });
    if (!started.ok) throw new Error('expected ok');
    const events = await collect(started);
    await started.done;
    expect(events.at(-1)).toMatchObject({ type: 'run_failed', message: 'missing TAVILY_API_KEY' });
    expect(await getRun(db, started.runId)).toMatchObject({ status: 'failed', settled: true });
    expect((await getLedger(db, utcDay(new Date())))!.reservedUsd).toBe(0);
  });

  it('aborts at maxRunMs and reports the time limit', async () => {
    const db = await testDb();
    const config = { ...loadConfig({}), maxRunMs: 20 };
    const started = await startRun({ db, config, identity, prompt: 'slow', buildDeps: buildDeps({ delayMs: 60 }) });
    if (!started.ok) throw new Error('expected ok');
    const events = await collect(started);
    await started.done;
    expect(events.at(-1)).toMatchObject({ type: 'run_failed', message: expect.stringMatching(/time limit/) });
  });

  it('rejects a prompt that is too short or too long without touching the database budget', async () => {
    const db = await testDb();
    const config = loadConfig({});
    for (const prompt of ['hi', 'x'.repeat(2001)]) {
      const r = await startRun({ db, config, identity, prompt, buildDeps: buildDeps() });
      expect(r).toMatchObject({ ok: false, status: 400, code: 'bad_prompt' });
    }
    expect(await getLedger(db, utcDay(new Date()))).toBeNull();
  });

  it('blocks a device over its daily quota with a 429 and spends nothing', async () => {
    const db = await testDb();
    const config = loadConfig({ RUNS_PER_DEVICE_PER_DAY: '1' });
    const first = await startRun({ db, config, identity, prompt: 'first run', buildDeps: buildDeps() });
    if (!first.ok) throw new Error('expected ok');
    await first.done;
    const second = await startRun({ db, config, identity, prompt: 'second run', buildDeps: buildDeps() });
    expect(second).toMatchObject({ ok: false, status: 429, code: 'quota' });
    expect((second as any).message).toMatch(/tomorrow/i);
  });

  it('REVIEW (final): a burst of parallel starts from one device admits only its daily quota', async () => {
    const db = await testDb();
    const config = loadConfig({ RUNS_PER_DEVICE_PER_DAY: '2' });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => startRun({ db, config, identity, prompt: `burst run ${i}`, buildDeps: buildDeps() })),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(2);
    expect(results.filter((r) => !r.ok).every((r: any) => r.code === 'quota')).toBe(true);
    await Promise.all(ok.map((r: any) => r.done));
    const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from runs');
    expect(n).toBe(2);
  });

  it('gives the visitor their quota back when the global budget refuses the run', async () => {
    const db = await testDb();
    const refused = await startRun({ db, config: loadConfig({ DAILY_SPEND_CAP_USD: '0.1' }), identity, prompt: 'over budget', buildDeps: buildDeps() });
    expect(refused).toMatchObject({ ok: false, code: 'spend' });
    const [{ used }] = await db.query<{ used: number }>('select coalesce(sum(count), 0)::int as used from quota_usage');
    expect(used).toBe(0);
  });

  it('refuses when the global daily spend cap would be exceeded', async () => {
    const db = await testDb();
    const config = loadConfig({ DAILY_SPEND_CAP_USD: '0.1' });
    const r = await startRun({ db, config, identity, prompt: 'over budget', buildDeps: buildDeps() });
    expect(r).toMatchObject({ ok: false, status: 429, code: 'spend' });
    const runs = await db.query('select id from runs');
    expect(runs).toHaveLength(0);
  });

  it('reaps stale runs left behind by killed functions before starting a new one', async () => {
    const db = await testDb();
    const stale = await seedRun(db, { status: 'running', startedAt: new Date(Date.now() - 20 * 60_000) });
    const started = await startRun({ db, config: loadConfig({}), identity, prompt: 'fresh run', buildDeps: buildDeps() });
    if (!started.ok) throw new Error('expected ok');
    await started.done;
    expect((await getRun(db, stale.runId))!.status).toBe('failed');
  });
});
