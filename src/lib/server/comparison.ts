import { COMPARISON_MODELS } from '@/lib/comparison/models';
import { estimateComparison } from '@/lib/comparison/estimate';
import type { Benchmarks, CandidateModel, ComparisonResult, PriceMap, StageStats } from '@/lib/comparison/types';
import type { AppConfig } from '@/lib/config';
import type { Stage } from '@/lib/models/types';
import type { Db } from '@/lib/store/db';
import { listEvents } from '@/lib/store/events';
import { getRun } from '@/lib/store/runs';

export interface ComparisonDeps {
  prices: { get(ids: string[]): Promise<{ prices: PriceMap; asOf: string | null }> };
  benchmarks: Benchmarks;
  candidates?: { id: string; label: string }[];
}

export type ComparisonOutcome =
  | { ok: true; result: ComparisonResult }
  | { ok: false; status: 404 | 409; error: 'not_found' | 'not_finished' };

export async function buildComparison(
  db: Db,
  config: AppConfig,
  runId: string,
  deps: ComparisonDeps,
): Promise<ComparisonOutcome> {
  const run = await getRun(db, runId);
  if (!run) return { ok: false, status: 404, error: 'not_found' };

  const events = await listEvents(db, runId);
  const started = events.find((e) => e.type === 'run_started');
  const finished = events.find((e) => e.type === 'run_finished');
  if (!finished) return { ok: false, status: 409, error: 'not_finished' };
  const wallMs = Math.max(0, finished.ts - (started?.ts ?? finished.ts));
  const rounds = events.filter((e) => e.type === 'queries_drafted').length;

  const rows = await db.query<{
    stage: Stage;
    model: string;
    calls: number;
    in_tokens: number;
    out_tokens: number;
    cost: number;
    latency: number;
  }>(
    `select stage, model, count(*)::int as calls,
            coalesce(sum(input_tokens), 0)::int as in_tokens,
            coalesce(sum(output_tokens), 0)::int as out_tokens,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            coalesce(sum(latency_ms), 0)::int as latency
       from model_calls
      where run_id = $1 and http_status between 200 and 299
      group by stage, model
      order by min(id)`,
    [runId],
  );
  const stages: StageStats[] = rows.map((r) => ({
    stage: r.stage,
    model: r.model,
    calls: Number(r.calls),
    inputTokens: Number(r.in_tokens),
    outputTokens: Number(r.out_tokens),
    costUsd: Number(r.cost),
    totalLatencyMs: Number(r.latency),
  }));

  const list = deps.candidates ?? COMPARISON_MODELS;
  const { prices, asOf } = await deps.prices.get(list.map((c) => c.id));
  const candidates: CandidateModel[] = list
    .filter((c) => prices[c.id])
    .map((c) => ({
      id: c.id,
      label: c.label,
      priceIn: prices[c.id].in,
      priceOut: prices[c.id].out,
      ttftMs: deps.benchmarks.models[c.id]?.ttftMs,
      tps: deps.benchmarks.models[c.id]?.tps,
    }));

  const { harness, alternatives } = estimateComparison({
    stages,
    wallMs,
    rounds,
    concurrency: config.fetch.concurrency,
    candidates,
  });

  return {
    ok: true,
    result: {
      harness,
      alternatives,
      pricesAsOf: asOf,
      benchmarkedAt: deps.benchmarks.benchmarkedAt,
      assumptions: [
        'Each alternative runs every step end to end with the same inputs this run used, priced at the model\'s current OpenRouter per-token prices.',
        'Query-scoring and relevance-judging calls are assumed to need 20 output tokens each when a general model does them; other steps keep this run\'s measured output size.',
        'Time re-times only the model work using each model\'s benchmarked first-token latency and generation speed, keeping this run\'s parallelism. Search, page fetching and overhead are identical in every row.',
        'First-token latency was measured on a 300-word generation and is applied to every call, which overstates short calls on models that reason before they answer.',
        'Answer quality is not compared. Reasoning models may spend extra tokens that are not modelled.',
      ],
    },
  };
}
