export const MAX_DURATION_SECONDS = 300;

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface AppConfig {
  models: { planner: string; classify: string; extract: string; summarize: string };
  tldrModel: 'extract' | 'summarize';
  /** Muse always reasons; effort trades answer depth for latency. */
  reasoning: { plan: ReasoningEffort; report: ReasoningEffort };
  limits: {
    runsPerDevicePerDay: number;
    ipMultiplier: number;
    dailySpendCapUsd: number;
    dailySearchBudget: number;
    reserveUsdPerRun: number;
    reserveSearchesPerRun: number;
    maxQueries: number;
    maxPages: number;
    maxPageChars: number;
  };
  scoring: { maxRounds: number; vagueBelow: number; preciseFrom: number };
  relevance: { threshold: number; maxChars: number };
  fetch: {
    maxBytes: number;
    maxBinaryBytes: number;
    timeoutMs: number;
    maxRedirects: number;
    concurrency: number;
    minChars: number;
  };
  search: { maxResultsPerQuery: number };
  report: { maxTokens: number };
  retry: { retries: number; baseMs: number; museRetries: number };
  maxRunMs: number;
  maxFunctionMs: number;
  reaperMarginMs: number;
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${key}: ${raw}`);
  return n;
}

function effort(env: Env, key: string, fallback: ReasoningEffort): ReasoningEffort {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'minimal' && raw !== 'low' && raw !== 'medium' && raw !== 'high') throw new Error(`Invalid ${key}: ${raw}`);
  return raw;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const tldr = env.TLDR_MODEL ?? 'extract';
  if (tldr !== 'extract' && tldr !== 'summarize') throw new Error(`Invalid TLDR_MODEL: ${tldr}`);
  const maxQueries = 8;
  return {
    models: {
      planner: env.PLANNER_MODEL || 'meta/muse-spark-1.3-contributor',
      classify: 'scaledown/classify-1',
      extract: 'scaledown/extract',
      summarize: 'scaledown/summarize',
    },
    tldrModel: tldr,
    reasoning: { plan: effort(env, 'MUSE_PLAN_EFFORT', 'minimal'), report: effort(env, 'MUSE_REPORT_EFFORT', 'low') },
    limits: {
      runsPerDevicePerDay: num(env, 'RUNS_PER_DEVICE_PER_DAY', 5),
      ipMultiplier: 3,
      dailySpendCapUsd: num(env, 'DAILY_SPEND_CAP_USD', 5),
      dailySearchBudget: num(env, 'SEARCH_BUDGET_PER_DAY', 100),
      reserveUsdPerRun: 0.15,
      reserveSearchesPerRun: maxQueries,
      maxQueries,
      maxPages: 30,
      maxPageChars: 200_000,
    },
    scoring: { maxRounds: 3, vagueBelow: 1.5, preciseFrom: 2.4 },
    relevance: { threshold: 0.5, maxChars: 20_000 },
    fetch: {
      maxBytes: 3_000_000,
      maxBinaryBytes: 10_000_000,
      timeoutMs: 15_000,
      maxRedirects: 4,
      concurrency: 6,
      minChars: 200,
    },
    search: { maxResultsPerQuery: 6 },
    report: { maxTokens: 8000 },
    retry: { retries: 1, baseMs: 400, museRetries: 2 },
    maxRunMs: 270_000,
    maxFunctionMs: MAX_DURATION_SECONDS * 1000,
    reaperMarginMs: 60_000,
  };
}
