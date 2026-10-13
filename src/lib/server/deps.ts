import type { AppConfig } from '@/lib/config';
import { createSafeFetch } from '@/lib/fetch/safeFetch';
import { fetchPage } from '@/lib/fetch/fetchPage';
import type { CostMeter } from '@/lib/models/cost';
import { judgeRelevance, scoreQuery } from '@/lib/models/decisions';
import { streamMuse } from '@/lib/models/muse';
import { makeTldr, summarize } from '@/lib/models/scaledown-chat';
import type { ModelCtx } from '@/lib/models/types';
import { createFakeDeps } from '@/lib/pipeline/fakes';
import type { PipelineDeps } from '@/lib/pipeline/run';
import { createTavilySearch } from '@/lib/search/tavily';
import type { Db } from '@/lib/store/db';
import { insertModelCall } from '@/lib/store/modelCalls';
import { upsertPage } from '@/lib/store/pages';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Server is missing ${name}`);
  return v;
}

export function buildPipelineDeps(i: {
  config: AppConfig;
  runId: string;
  db: Db;
  signal: AbortSignal;
  meter: CostMeter;
}): PipelineDeps {
  if (process.env.FAKE_MODELS === '1') {
    return createFakeDeps({
      meter: i.meter,
      signal: i.signal,
      delayMs: Number(process.env.FAKE_DELAY_MS ?? 0),
      record: (rec) => insertModelCall(i.db, i.runId, rec),
    });
  }

  const { config, db, runId, signal, meter } = i;
  const ctx: ModelCtx = {
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    baseUrl: 'https://openrouter.ai/api',
    fetchImpl: fetch,
    signal,
    retry: { retries: config.retry.museRetries, baseMs: config.retry.baseMs },
    record: async (rec) => {
      meter.add(rec.costUsd);
      await insertModelCall(db, runId, rec);
    },
  };
  const safeFetch = createSafeFetch();

  return {
    config,
    signal,
    cost: meter,
    muse: (req) => streamMuse(ctx, config.models.planner, req.stage ?? (req.tools ? 'plan' : 'report'), req),
    scoreQuery: (q) => scoreQuery(ctx, config, q),
    judgeRelevance: (question, text) => judgeRelevance(ctx, config, question, text),
    summarize: (input) => summarize(ctx, config, input),
    tldr: (text) => makeTldr(ctx, config, text),
    search: createTavilySearch({ apiKey: requireEnv('TAVILY_API_KEY') }),
    fetchPage: (url) =>
      fetchPage(url, { fetchImpl: safeFetch, limits: config.fetch, maxChars: config.limits.maxPageChars, signal }),
    recordPage: (p) => upsertPage(db, runId, p),
  };
}
