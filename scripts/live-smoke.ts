import 'dotenv/config';
import { loadConfig } from '../src/lib/config';
import type { ModelCtx } from '../src/lib/models/types';
import { judgeRelevance, scoreQuery } from '../src/lib/models/decisions';
import { extractTldr, summarize } from '../src/lib/models/scaledown-chat';
import { streamMuse } from '../src/lib/models/muse';
import { planTools } from '../src/lib/pipeline/tools';
import { PLANNER_SYSTEM } from '../src/lib/prompts';
import { createTavilySearch } from '../src/lib/search/tavily';
import { fetchPage } from '../src/lib/fetch/fetchPage';
import { createSafeFetch } from '../src/lib/fetch/safeFetch';
import { UnsafeUrlError } from '../src/lib/fetch/errors';

const config = loadConfig();
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is not set');
const ctx: ModelCtx = { apiKey: key, baseUrl: 'https://openrouter.ai/api', fetchImpl: fetch, record: () => {} };

let failures = 0;
async function check(name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn(); // await first: a template literal would read the clock before fn() finished
    console.log(`PASS ${name} (${Date.now() - t0} ms): ${detail}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

(async () => {
  await check('classify score_query', async () => {
    const vague = await scoreQuery(ctx, config, 'ai');
    const precise = await scoreQuery(ctx, config, 'SEC 10-K risk factor disclosures for NVIDIA fiscal 2025');
    if (!(vague.score < precise.score)) throw new Error(`expected vague < precise, got ${vague.score} vs ${precise.score}`);
    return `vague=${vague.score.toFixed(2)} precise=${precise.score.toFixed(2)}`;
  });
  await check('classify judge_relevance', async () => {
    const q = 'How does chunking affect retrieval quality in legal RAG?';
    const yes = await judgeRelevance(ctx, config, q, 'Section-aware chunking preserves clause boundaries and improves retrieval recall for legal documents in RAG pipelines.');
    const no = await judgeRelevance(ctx, config, q, 'Sourdough bread needs a long, cold fermentation to develop flavor and an open crumb.');
    if (!(yes.relevance > no.relevance)) throw new Error(`expected relevant > irrelevant, got ${yes.relevance} vs ${no.relevance}`);
    return `relevant=${yes.relevance.toFixed(2)} irrelevant=${no.relevance.toFixed(2)}`;
  });
  await check('summarize', async () => {
    const out = await summarize(ctx, config, { instruction: 'Summarize in one sentence.', text: 'The Northwind Water Authority reported a 3 percent rise in drinking water production in 2025, reaching 412 million gallons per day. '.repeat(6) });
    return out.text.slice(0, 120);
  });
  await check('extract tldr', async () => (await extractTldr(ctx, config, 'Section-aware chunking keeps clauses together. '.repeat(20))).text.slice(0, 120));
  await check('muse tool streaming', async () => {
    const kinds: string[] = [];
    for await (const ev of streamMuse(ctx, config.models.planner, 'plan', {
      messages: [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: 'Research how bees navigate.' }],
      tools: planTools,
      maxTokens: 1000,
      reasoningEffort: config.reasoning.plan,
    })) kinds.push(ev.type === 'tool_call' ? `tool_call:${ev.call.name}` : ev.type);
    if (!kinds.some((k) => k.startsWith('tool_call:'))) throw new Error(`no tool call: ${kinds.join(',')}`);
    return kinds.join(' ');
  });
  await check('tavily search', async () => {
    if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set');
    const r = await createTavilySearch({ apiKey: process.env.TAVILY_API_KEY }).search('retrieval augmented generation chunking', { maxResults: 3 });
    if (r.length === 0) throw new Error('no results');
    return r.map((x) => x.url).join(' ');
  });
  await check('fetchPage (real page)', async () => {
    const p = await fetchPage('https://en.wikipedia.org/wiki/Retrieval-augmented_generation', { fetchImpl: createSafeFetch(), limits: config.fetch, maxChars: config.limits.maxPageChars });
    if (p.kind !== 'markdown') throw new Error('expected markdown');
    return `${p.title} (${p.markdown.length} chars)`;
  });
  await check('SSRF guard blocks the metadata address', async () => {
    try {
      await fetchPage('http://169.254.169.254/latest/meta-data/', { fetchImpl: createSafeFetch(), limits: config.fetch, maxChars: 1000 });
    } catch (e) {
      if (e instanceof UnsafeUrlError) return 'blocked';
      throw e;
    }
    throw new Error('request was NOT blocked');
  });
  process.exit(failures ? 1 : 0);
})();
