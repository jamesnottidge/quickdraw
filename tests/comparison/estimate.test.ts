import { describe, it, expect } from 'vitest';
import { estimateComparison } from '@/lib/comparison/estimate';
import type { CandidateModel, EstimateInput, StageStats } from '@/lib/comparison/types';

const stage = (s: Partial<StageStats> & Pick<StageStats, 'stage'>): StageStats => ({
  model: 'm', calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, totalLatencyMs: 0, ...s,
});

// A realistic run: 2 plan calls, 2 scoring rounds of 3 queries, 10 pages (judge + summarize),
// then report, tldr, artifact. Mean per-call latencies: plan 3000, score 1000, judge 2000,
// summarize 6000, report 20000, tldr 2000, artifact 60000 ms.
const stages: StageStats[] = [
  stage({ stage: 'plan', model: 'muse', calls: 2, inputTokens: 1000, outputTokens: 200, costUsd: 0.0004, totalLatencyMs: 6000 }),
  stage({ stage: 'score_query', model: 'classify', calls: 6, inputTokens: 2000, outputTokens: 6, costUsd: 0.0001, totalLatencyMs: 6000 }),
  stage({ stage: 'judge_relevance', model: 'classify', calls: 10, inputTokens: 40000, outputTokens: 10, costUsd: 0.0005, totalLatencyMs: 20000 }),
  stage({ stage: 'summarize', model: 'summarize', calls: 6, inputTokens: 24000, outputTokens: 3000, costUsd: 0.0002, totalLatencyMs: 36000 }),
  stage({ stage: 'report', model: 'muse', calls: 1, inputTokens: 5000, outputTokens: 2000, costUsd: 0.001, totalLatencyMs: 20000 }),
  stage({ stage: 'tldr', model: 'extract', calls: 1, inputTokens: 2000, outputTokens: 100, costUsd: 0.00001, totalLatencyMs: 2000 }),
  stage({ stage: 'artifact', model: 'muse', calls: 1, inputTokens: 3000, outputTokens: 8000, costUsd: 0.003, totalLatencyMs: 60000 }),
];

const x: CandidateModel = { id: 'x/model', label: 'Model X', priceIn: 2e-6, priceOut: 1e-5, ttftMs: 500, tps: 100 };
const base: EstimateInput = { stages, wallMs: 150_000, rounds: 2, concurrency: 6, candidates: [x] };

describe('estimateComparison', () => {
  it('reports the harness as measured: summed cost, given wall clock, per-stage breakdown', () => {
    const { harness } = estimateComparison(base);
    expect(harness.kind).toBe('harness');
    expect(harness.costUsd).toBeCloseTo(0.00521, 8);
    expect(harness.wallMs).toBe(150_000);
    expect(harness.stages.map((s) => s.stage)).toEqual(['plan', 'score_query', 'judge_relevance', 'summarize', 'report', 'tldr', 'artifact']);
    expect(harness.stages[0]).toEqual({ stage: 'plan', model: 'muse', calls: 2, inputTokens: 1000, outputTokens: 200, costUsd: 0.0004 });
  });

  it('prices an LLM-only run: same input tokens, measured output for generative stages, 20 tokens per classification call', () => {
    const [alt] = estimateComparison(base).alternatives;
    // input 77,000 x 2e-6 = 0.154 ; output 200+120+200+3000+2000+100+8000 = 13,620 x 1e-5 = 0.1362
    expect(alt.costUsd).toBeCloseTo(0.2902, 6);
    expect(alt.costVsHarness).toBeCloseTo(0.2902 / 0.00521, 4);
    expect(alt.kind).toBe('estimate');
  });

  it('estimates time by re-timing only the model work, keeping the run\'s own parallelism and non-model time', () => {
    // harness model time = 6000 + 2000 + 11200 + 20000 + 2000 + 60000 = 101,200 -> non-model = 48,800
    // alt model time     = 3000 + 1400 +  8000 + 20500 + 1500 + 80500 = 114,900 -> total 163,700
    const [alt] = estimateComparison(base).alternatives;
    expect(alt.wallMs).toBe(163_700);
    expect(alt.timeVsHarness).toBeCloseTo(163_700 / 150_000, 4);
  });

  it('shows n/a time (but still a cost) for a model with no benchmark', () => {
    const noBench: CandidateModel = { id: 'y/model', label: 'Model Y', priceIn: 1e-6, priceOut: 2e-6 };
    const [alt] = estimateComparison({ ...base, candidates: [noBench] }).alternatives;
    expect(alt.wallMs).toBeNull();
    expect(alt.timeVsHarness).toBeNull();
    expect(alt.costUsd).toBeGreaterThan(0);
  });

  it('REVIEW FOCUS: a run with no model calls produces a valid table with no NaN or Infinity', () => {
    const empty = estimateComparison({ stages: [], wallMs: 5000, rounds: 0, concurrency: 6, candidates: [x] });
    expect(empty.harness.costUsd).toBe(0);
    expect(empty.harness.stages).toEqual([]);
    const [alt] = empty.alternatives;
    expect(alt.costUsd).toBe(0);
    expect(alt.costVsHarness).toBeNull(); // harness cost is zero: no meaningful ratio
    expect(alt.wallMs).toBe(5000); // only the non-model remainder
    for (const v of [alt.costUsd, alt.wallMs, alt.timeVsHarness]) expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it('never lets the non-model remainder go negative when measured wall clock is shorter than modelled time', () => {
    const [alt] = estimateComparison({ ...base, wallMs: 10_000 }).alternatives;
    expect(alt.wallMs).toBe(114_900); // remainder floored at 0
  });

  it('handles a stage that used two models (for example a TLDR fallback) by summing it', () => {
    const merged = estimateComparison({
      ...base,
      stages: [...stages, stage({ stage: 'tldr', model: 'summarize', calls: 1, inputTokens: 1000, outputTokens: 50, costUsd: 0.00002, totalLatencyMs: 1000 })],
    });
    const tldr = merged.harness.stages.filter((s) => s.stage === 'tldr');
    expect(tldr).toHaveLength(2); // the breakdown keeps one row per (stage, model)
    expect(merged.harness.costUsd).toBeCloseTo(0.00523, 8);
  });
});
