import type { Stage } from '@/lib/models/types';

export interface StageStats {
  stage: Stage;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  totalLatencyMs: number;
}

export interface CandidateModel {
  id: string;
  label: string;
  /** USD per input token. */
  priceIn: number;
  /** USD per output token. */
  priceOut: number;
  /** From the benchmark; absent means time cannot be estimated. */
  ttftMs?: number;
  tps?: number;
}

export interface EstimateInput {
  stages: StageStats[];
  /** Measured wall clock of the whole run. */
  wallMs: number;
  /** Number of query-scoring rounds (scoring calls inside a round run in parallel). */
  rounds: number;
  /** Page-processing concurrency used by the run. */
  concurrency: number;
  candidates: CandidateModel[];
}

export interface StageBreakdown {
  stage: Stage;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface HarnessRow {
  kind: 'harness';
  label: string;
  costUsd: number;
  wallMs: number;
  stages: StageBreakdown[];
}

export interface EstimateRow {
  kind: 'estimate';
  id: string;
  label: string;
  costUsd: number;
  wallMs: number | null;
  costVsHarness: number | null;
  timeVsHarness: number | null;
}

export interface ComparisonResult {
  harness: HarnessRow;
  alternatives: EstimateRow[];
  assumptions: string[];
  pricesAsOf: string | null;
  benchmarkedAt: string | null;
}

export interface Benchmarks {
  benchmarkedAt: string | null;
  prompt: string | null;
  models: Record<string, { ttftMs: number; tps: number; trials: number }>;
}

export type PriceMap = Record<string, { in: number; out: number }>;
