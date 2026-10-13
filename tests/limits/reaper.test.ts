import { describe, it, expect } from 'vitest';
import { reapStaleRuns } from '@/lib/limits/reaper';
import { getLedger, reserve } from '@/lib/limits/budget';
import { getRun } from '@/lib/store/runs';
import { insertModelCall } from '@/lib/store/modelCalls';
import { insertEvent, listEvents } from '@/lib/store/events';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const cfg = loadConfig({});
const now = new Date('2026-10-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('reapStaleRuns', () => {
  it('REVIEW FOCUS: fails a run whose function was killed and releases its reservation using actual cost', async () => {
    const db = await testDb();
    await reserve(db, cfg, now);
    const { runId } = await seedRun(db, {
      status: 'running', startedAt: minutesAgo(10), reservedUsd: 0.15, reservedSearches: 8, ledgerDay: '2026-10-13',
    });
    await insertModelCall(db, runId, {
      stage: 'summarize', model: 'm', request: {}, response: {}, httpStatus: 200, latencyMs: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.01,
    });
    await insertEvent(db, { runId, seq: 1, ts: now.getTime(), type: 'search_started', query: 'q' });
    await insertEvent(db, { runId, seq: 2, ts: now.getTime(), type: 'search_started', query: 'q2' });

    expect(await reapStaleRuns(db, cfg, now)).toBe(1);

    const run = await getRun(db, runId);
    expect(run).toMatchObject({ status: 'failed', settled: true });
    expect(run!.error).toMatch(/terminated/i);
    expect(run!.cost_usd).toBeCloseTo(0.01, 8);
    expect(await getLedger(db, '2026-10-13')).toEqual({ reservedUsd: 0, actualUsd: 0.01, searchReserved: 0, searchUsed: 2 });
    // the trace ends with a terminal event, so a replay shows "failed" instead of an endless spinner
    const events = await listEvents(db, runId);
    expect(events.at(-1)).toMatchObject({ seq: 3, type: 'run_failed' });
  });

  it('leaves recent running runs and already-finished runs alone', async () => {
    const db = await testDb();
    const fresh = await seedRun(db, { status: 'running', startedAt: minutesAgo(1) });
    const done = await seedRun(db, { status: 'finished', startedAt: minutesAgo(30) });
    expect(await reapStaleRuns(db, cfg, now)).toBe(0);
    expect((await getRun(db, fresh.runId))!.status).toBe('running');
    expect((await getRun(db, done.runId))!.status).toBe('finished');
  });

  it('is safe to run twice', async () => {
    const db = await testDb();
    await seedRun(db, { status: 'running', startedAt: minutesAgo(10) });
    expect(await reapStaleRuns(db, cfg, now)).toBe(1);
    expect(await reapStaleRuns(db, cfg, now)).toBe(0);
  });
});
