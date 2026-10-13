import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildComparison } from '@/lib/server/comparison';
import { insertEvent } from '@/lib/store/events';
import { insertModelCall } from '@/lib/store/modelCalls';
import { loadConfig } from '@/lib/config';
import type { Benchmarks } from '@/lib/comparison/types';
import { seedRun, testDb } from '../helpers/db';

const config = loadConfig({});
const benchmarks: Benchmarks = {
  benchmarkedAt: '2026-10-12T00:00:00.000Z',
  prompt: 'p',
  models: { 'a/model': { ttftMs: 400, tps: 80, trials: 3 } },
};
const prices = {
  async get(ids: string[]) {
    const all: Record<string, { in: number; out: number }> = { 'a/model': { in: 2e-6, out: 1e-5 }, 'b/model': { in: 1e-6, out: 2e-6 } };
    return { prices: Object.fromEntries(ids.filter((i) => all[i]).map((i) => [i, all[i]])), asOf: '2026-10-13T00:00:00.000Z' };
  },
};
const candidates = [{ id: 'a/model', label: 'A' }, { id: 'b/model', label: 'B' }, { id: 'missing/model', label: 'Missing' }];

async function call(db: any, runId: string, stage: any, model: string, o: Partial<{ inT: number; outT: number; cost: number; ms: number }> = {}) {
  await insertModelCall(db, runId, {
    stage, model, request: {}, response: {}, httpStatus: 200, latencyMs: o.ms ?? 1000,
    inputTokens: o.inT ?? 100, outputTokens: o.outT ?? 10, costUsd: o.cost ?? 0.001,
  });
}

describe('buildComparison', () => {
  it('builds the harness row from recorded calls and events, and one estimate per priced candidate', async () => {
    const db = await testDb();
    const { runId } = await seedRun(db, { status: 'finished' });
    await insertEvent(db, { runId, seq: 1, ts: 1_000, type: 'run_started', prompt: 'p' });
    await insertEvent(db, { runId, seq: 2, ts: 2_000, type: 'queries_drafted', round: 1, queries: ['a', 'b'] });
    await insertEvent(db, { runId, seq: 3, ts: 61_000, type: 'run_finished', costUsd: 0.005 });
    await call(db, runId, 'plan', 'meta/muse-spark-1.3-contributor', { cost: 0.002 });
    await call(db, runId, 'score_query', 'scaledown/classify-1', { cost: 0.0001 });
    await call(db, runId, 'judge_relevance', 'scaledown/classify-1', { cost: 0.0002 });
    await call(db, runId, 'summarize', 'scaledown/summarize', { cost: 0.0003 });
    await call(db, runId, 'report', 'meta/muse-spark-1.3-contributor', { cost: 0.002 });

    const out = await buildComparison(db, config, runId, { prices, benchmarks, candidates });
    if (!out.ok) throw new Error('expected ok');
    const { result } = out;
    expect(result.harness.wallMs).toBe(60_000);
    expect(result.harness.costUsd).toBeCloseTo(0.0046, 8);
    expect(result.harness.stages.map((s) => s.stage).sort()).toEqual(['judge_relevance', 'plan', 'report', 'score_query', 'summarize']);
    expect(result.alternatives.map((a) => a.id)).toEqual(['a/model', 'b/model']); // 'missing/model' has no price: omitted
    expect(result.alternatives[0].wallMs).not.toBeNull(); // benchmarked
    expect(result.alternatives[1].wallMs).toBeNull(); // not benchmarked: n/a
    expect(result.pricesAsOf).toBe('2026-10-13T00:00:00.000Z');
    expect(result.benchmarkedAt).toBe('2026-10-12T00:00:00.000Z');
    expect(result.assumptions.join(' ')).toMatch(/20 output tokens/);
    expect(result.assumptions.join(' ')).toMatch(/quality/i);
  });

  it('answers not-found for an unknown run and not-finished before run_finished', async () => {
    const db = await testDb();
    expect(await buildComparison(db, config, randomUUID(), { prices, benchmarks, candidates })).toEqual({ ok: false, status: 404, error: 'not_found' });
    const { runId } = await seedRun(db, { status: 'running' });
    await insertEvent(db, { runId, seq: 1, ts: 1_000, type: 'run_started', prompt: 'p' });
    expect(await buildComparison(db, config, runId, { prices, benchmarks, candidates })).toEqual({ ok: false, status: 409, error: 'not_finished' });
  });

  it('REVIEW FOCUS: a finished run with zero model calls yields a JSON-safe table', async () => {
    const db = await testDb();
    const { runId } = await seedRun(db, { status: 'finished' });
    await insertEvent(db, { runId, seq: 1, ts: 1_000, type: 'run_started', prompt: 'p' });
    await insertEvent(db, { runId, seq: 2, ts: 4_000, type: 'run_finished', costUsd: 0 });
    const out = await buildComparison(db, config, runId, { prices, benchmarks, candidates });
    if (!out.ok) throw new Error('expected ok');
    expect(out.result.harness.costUsd).toBe(0);
    expect(JSON.parse(JSON.stringify(out.result))).toEqual(out.result); // no NaN / Infinity (they would become null)
    for (const a of out.result.alternatives) expect(a.costVsHarness).toBeNull();
  });
});
