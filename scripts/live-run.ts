import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/lib/config';
import { buildPipelineDeps } from '../src/lib/server/deps';
import { startRun } from '../src/lib/server/startRun';
import { createPgliteDb } from '../src/lib/store/pglite';
import { migrate } from '../src/lib/store/migrate';
import { extractTldr, summarize } from '../src/lib/models/scaledown-chat';
import type { ModelCtx } from '../src/lib/models/types';
import type { RunEvent } from '../src/lib/events/schema';

function brief(ev: RunEvent): string {
  switch (ev.type) {
    case 'query_scored': return `${ev.query} -> ${ev.score.toFixed(2)} ${ev.band} (conf ${ev.confidence.toFixed(2)})`;
    case 'page_judged': return `${ev.url} relevance ${ev.relevance.toFixed(2)} ${ev.relevant ? 'KEEP' : 'drop'}`;
    case 'page_failed': return `${ev.url} ${ev.reason}`;
    case 'page_fetched': return `${ev.url} ${ev.chars} chars`;
    case 'queries_submitted': return `${ev.queries.join(' | ')}${ev.capped ? ' (capped)' : ''}`;
    case 'search_results': return `${ev.query}: ${ev.results.length} results`;
    case 'report_done': return `${ev.text.length} chars`;
    case 'run_finished': return `cost $${ev.costUsd.toFixed(5)}`;
    default: return JSON.stringify(ev).slice(0, 110);
  }
}

(async () => {
  const prompt = process.argv.slice(2).join(' ') || 'How do chunking strategies affect retrieval quality for legal documents in RAG systems?';
  const config = loadConfig();
  const db = await createPgliteDb();
  await migrate(db);
  const t0 = Date.now();
  const started = await startRun({
    db, config, prompt,
    identity: { deviceId: randomUUID(), ipHash: 'local', userAgent: 'live-run', isNewDevice: true },
    buildDeps: ({ runId, signal, meter }) => buildPipelineDeps({ config, runId, db, signal, meter }),
  });
  if (!started.ok) throw new Error(`rejected: ${started.message}`);

  let report = '';
  for await (const ev of started.channel) {
    if (ev.type === 'report_delta') continue;
    if (ev.type === 'report_done') report = ev.text;
    console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s ${ev.type.padEnd(18)} ${brief(ev)}`);
  }
  await started.done;
  console.log(`\nwall clock ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const stages = await db.query<any>(
    `select stage, count(*)::int as calls, sum(cost_usd)::float8 as cost, avg(latency_ms)::int as avg_ms, max(latency_ms)::int as max_ms
       from model_calls group by stage order by stage`,
  );
  console.table(stages);

  if (report) {
    const ctx: ModelCtx = { apiKey: process.env.OPENROUTER_API_KEY!, baseUrl: 'https://openrouter.ai/api', fetchImpl: fetch, record: () => {} };
    console.log('\nTLDR via extract  :', await extractTldr(ctx, config, report).then((r) => r.text).catch((e) => `FAILED: ${e.message}`));
    console.log('TLDR via summarize:', await summarize(ctx, config, { instruction: 'Write a one-sentence TLDR of the text. Output only that sentence.', text: report }).then((r) => r.text).catch((e) => `FAILED: ${e.message}`));
  }
  process.exit(0);
})();
