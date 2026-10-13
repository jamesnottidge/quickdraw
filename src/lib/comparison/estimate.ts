import type { Stage } from '@/lib/models/types';
import type { CandidateModel, EstimateInput, EstimateRow, HarnessRow, StageBreakdown, StageStats } from './types';

/** Calls a general LLM would answer in a few words. */
export const CLASSIFY_OUTPUT_TOKENS = 20;
const CLASSIFY_STAGES = new Set<Stage>(['score_query', 'judge_relevance']);

interface Agg {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
}
const ZERO: Agg = { calls: 0, inputTokens: 0, outputTokens: 0, totalLatencyMs: 0 };

function aggregate(stages: StageStats[]): Map<Stage, Agg> {
  const out = new Map<Stage, Agg>();
  for (const s of stages) {
    const prev = out.get(s.stage) ?? { ...ZERO };
    out.set(s.stage, {
      calls: prev.calls + s.calls,
      inputTokens: prev.inputTokens + s.inputTokens,
      outputTokens: prev.outputTokens + s.outputTokens,
      totalLatencyMs: prev.totalLatencyMs + s.totalLatencyMs,
    });
  }
  return out;
}

/** Output tokens an LLM-only run would produce for a stage. */
function altOutputTokens(stage: Stage, a: Agg): number {
  return CLASSIFY_STAGES.has(stage) ? a.calls * CLASSIFY_OUTPUT_TOKENS : a.outputTokens;
}

/**
 * Model time of a run, arranged as the run actually arranged it: planning calls one after another,
 * query scoring in parallel within a round, each page a judge-then-summarize chain with the run's
 * page concurrency, and the report, TLDR and artifact one call each.
 */
function modelTimeMs(
  agg: Map<Stage, Agg>,
  rounds: number,
  concurrency: number,
  perCallMs: (stage: Stage, a: Agg) => number,
): number {
  const get = (s: Stage) => agg.get(s) ?? ZERO;
  const t = (s: Stage) => (get(s).calls > 0 ? perCallMs(s, get(s)) : 0);

  let total = get('plan').calls * t('plan');
  const score = get('score_query');
  total += (rounds > 0 ? rounds : score.calls) * t('score_query');

  const judge = get('judge_relevance');
  const summarize = get('summarize');
  if (judge.calls > 0) {
    const chain = t('judge_relevance') + (summarize.calls / judge.calls) * t('summarize');
    total += Math.ceil(judge.calls / Math.max(1, concurrency)) * chain;
  } else {
    total += summarize.calls * t('summarize');
  }

  for (const s of ['report', 'tldr', 'artifact'] as const) total += get(s).calls * t(s);
  return total;
}

function altCostUsd(agg: Map<Stage, Agg>, c: CandidateModel): number {
  let cost = 0;
  for (const [stage, a] of agg) cost += a.inputTokens * c.priceIn + altOutputTokens(stage, a) * c.priceOut;
  return cost;
}

function ratio(num: number, den: number): number | null {
  return den > 0 && Number.isFinite(num / den) ? num / den : null;
}

export function estimateComparison(input: EstimateInput): { harness: HarnessRow; alternatives: EstimateRow[] } {
  const agg = aggregate(input.stages);

  const harnessCost = input.stages.reduce((sum, s) => sum + s.costUsd, 0);
  const breakdown: StageBreakdown[] = input.stages.map((s) => ({
    stage: s.stage,
    model: s.model,
    calls: s.calls,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    costUsd: s.costUsd,
  }));

  const ownModelTime = modelTimeMs(agg, input.rounds, input.concurrency, (_s, a) => a.totalLatencyMs / a.calls);
  const nonModel = Math.max(0, input.wallMs - ownModelTime);

  const alternatives: EstimateRow[] = input.candidates.map((c) => {
    const costUsd = altCostUsd(agg, c);
    let wallMs: number | null = null;
    if (c.ttftMs !== undefined && c.tps !== undefined && c.tps > 0) {
      const ttft = c.ttftMs;
      const tps = c.tps;
      const altModel = modelTimeMs(agg, input.rounds, input.concurrency, (s, a) => {
        const outPerCall = altOutputTokens(s, a) / a.calls;
        return ttft + (outPerCall / tps) * 1000;
      });
      wallMs = Math.round(nonModel + altModel);
    }
    return {
      kind: 'estimate',
      id: c.id,
      label: c.label,
      costUsd,
      wallMs,
      costVsHarness: ratio(costUsd, harnessCost),
      timeVsHarness: wallMs === null ? null : ratio(wallMs, input.wallMs),
    };
  });

  return {
    harness: { kind: 'harness', label: 'This harness (mixed models)', costUsd: harnessCost, wallMs: input.wallMs, stages: breakdown },
    alternatives,
  };
}
