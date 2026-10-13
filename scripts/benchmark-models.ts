import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { COMPARISON_MODELS } from '../src/lib/comparison/models';
import { streamMuse } from '../src/lib/models/muse';
import type { ModelCtx } from '../src/lib/models/types';

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is not set');

const dir = path.join(__dirname, '../src/lib/comparison');
const PROMPT = 'Write about 300 words explaining how honeybees navigate back to their hive. Plain prose, no headings.';
const TRIALS = 3;
const pricesOnly = process.argv.includes('--prices-only');

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function refreshPrices() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const json = (await res.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
  const byId = new Map(json.data.map((m) => [m.id, m.pricing]));
  const prices: Record<string, { in: number; out: number }> = {};
  for (const m of COMPARISON_MODELS) {
    const p = byId.get(m.id);
    if (p) prices[m.id] = { in: Number(p.prompt), out: Number(p.completion) };
    else console.log(`price: ${m.id} not found on OpenRouter`);
  }
  fs.writeFileSync(path.join(dir, 'prices.snapshot.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), prices }, null, 2) + '\n');
  console.log(`wrote prices for ${Object.keys(prices).length} models`);
}

async function benchOne(id: string) {
  const ctx: ModelCtx = {
    apiKey: key!,
    baseUrl: 'https://openrouter.ai/api',
    fetchImpl: fetch,
    record: () => {},
    retry: { retries: 1, baseMs: 500 },
  };
  const trials: { ttftMs: number; tps: number }[] = [];
  for (let i = 0; i < TRIALS; i++) {
    const t0 = performance.now();
    let first: number | null = null;
    let chars = 0;
    try {
      for await (const ev of streamMuse(ctx, id, 'plan', { messages: [{ role: 'user', content: PROMPT }], maxTokens: 1500 })) {
        if (ev.type === 'text') {
          if (first === null) first = performance.now();
          chars += ev.delta.length;
        }
      }
    } catch (e) {
      console.log(`  ${id} trial ${i + 1} failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const end = performance.now();
    if (first === null || chars < 200) continue;
    // Visible tokens are approximated from characters; reasoning time lands in the first-token latency.
    trials.push({ ttftMs: first - t0, tps: chars / 4 / Math.max(0.05, (end - first) / 1000) });
  }
  if (trials.length === 0) return null;
  return { ttftMs: Math.round(median(trials.map((t) => t.ttftMs))), tps: Math.round(median(trials.map((t) => t.tps)) * 10) / 10, trials: trials.length };
}

(async () => {
  await refreshPrices();
  if (pricesOnly) return;
  const models: Record<string, { ttftMs: number; tps: number; trials: number }> = {};
  for (const m of COMPARISON_MODELS) {
    process.stdout.write(`benchmarking ${m.id} ... `);
    const r = await benchOne(m.id);
    console.log(r ? `ttft ${r.ttftMs} ms, ${r.tps} tok/s (${r.trials} trials)` : 'no usable trials');
    if (r) models[m.id] = r;
  }
  fs.writeFileSync(path.join(dir, 'benchmarks.json'), JSON.stringify({ benchmarkedAt: new Date().toISOString(), prompt: PROMPT, models }, null, 2) + '\n');
  console.log('wrote benchmarks.json');
})();
