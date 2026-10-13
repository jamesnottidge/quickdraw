import { loadConfig } from '@/lib/config';
import { FetchError } from '@/lib/fetch/errors';
import type { FetchedPage } from '@/lib/fetch/fetchPage';
import { ARTIFACT_SYSTEM } from '@/lib/artifact/prompt';
import { CostMeter } from '@/lib/models/cost';
import type { MuseEvent, MuseRequest } from '@/lib/models/muse';
import type { ModelCallRecord } from '@/lib/models/types';
import type { PipelineDeps } from './run';

export interface FakeOptions {
  meter?: CostMeter;
  signal?: AbortSignal;
  delayMs?: number;
  noResults?: boolean;
  failTldr?: boolean;
  museError?: Error;
  failArtifact?: boolean;
  /** Called for every fake model call, so fake runs have recorded calls (used by the comparison). */
  record?: (r: ModelCallRecord) => void | Promise<void>;
}

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
const FINISH_TOOLS: MuseEvent = { type: 'finish', reason: 'tool_calls', costUsd: 0, inputTokens: 0, outputTokens: 0 };
const FINISH_STOP: MuseEvent = { type: 'finish', reason: 'stop', costUsd: 0, inputTokens: 0, outputTokens: 0 };

const REPORT_TEXT =
  '# Chunking for legal RAG\n\nSection-aware chunking improves retrieval recall on long contracts [1].\n\n## Findings\n\n- Fixed windows split clauses from their cross references [2].\n- Parent metadata helps the model cite the right section [1].\n\n## Conclusion\n\nPrefer structure-aware chunking for legal text.\n';

/** A small interactive page that also probes its own sandbox; used by tests and fake mode. */
export const FAKE_ARTIFACT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Interactive view</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#fff;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}
button{padding:8px 14px;border-radius:8px;border:1px solid #888;background:transparent;color:inherit;cursor:pointer}
pre{background:rgba(127,127,127,.15);padding:12px;border-radius:8px}
</style></head><body>
<h1 id="title">Chunking for legal RAG</h1>
<button id="toggle">Show details</button>
<p id="details" hidden>Section-aware chunking keeps clauses and cross references together [1].</p>
<pre id="probe" hidden>probing</pre>
<script>
document.getElementById('toggle').addEventListener('click', function () {
  var d = document.getElementById('details'); d.hidden = !d.hidden;
  this.textContent = d.hidden ? 'Show details' : 'Hide details';
});
(async function () {
  var r = {};
  try { void document.cookie; r.cookie = 'readable'; } catch (e) { r.cookie = 'blocked'; }
  try { void parent.document.title; r.parent = 'reachable'; } catch (e) { r.parent = 'blocked'; }
  try { await fetch(location.origin === 'null' ? 'http://localhost:3100/api/stats' : '/api/stats'); r.fetch = 'reachable'; } catch (e) { r.fetch = 'blocked'; }
  document.getElementById('probe').textContent = JSON.stringify(r);
})();
</script></body></html>`;

/** Scripted, offline pipeline dependencies for tests, e2e and local development (FAKE_MODELS=1). */
export function createFakeDeps(opts: FakeOptions = {}): PipelineDeps {
  const config = loadConfig({});
  const meter = opts.meter ?? new CostMeter();
  const rec = async (
    stage: ModelCallRecord['stage'],
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    latencyMs: number,
  ) => {
    await opts.record?.({
      stage, model, request: { fake: true }, response: { fake: true },
      httpStatus: 200, latencyMs, inputTokens, outputTokens, costUsd,
    });
  };
  const delay = async () => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.signal?.aborted) throw new Error('aborted');
  };
  let planStep = 0;

  const toolCall = (id: string, name: string, args: unknown): MuseEvent => ({
    type: 'tool_call',
    call: { id, name, args, rawArgs: JSON.stringify(args) },
  });

  return {
    config,
    signal: opts.signal,
    cost: meter,
    sleep: async () => {},
    muse: (req: MuseRequest) =>
      (async function* (): AsyncGenerator<MuseEvent> {
        await delay();
        if (opts.museError) throw opts.museError;
        meter.add(0.0002);
        if (req.tools) {
          planStep++;
          if (planStep === 1) {
            yield { type: 'tool_drafting', name: 'score_queries' };
            yield toolCall('c1', 'score_queries', { queries: ['ai', 'legal RAG chunking strategies retrieval quality'] });
          } else {
            yield { type: 'tool_drafting', name: 'submit_queries' };
            yield toolCall('c2', 'submit_queries', {
              queries: ['legal RAG chunking strategies retrieval quality', 'section-aware chunking contracts recall'],
            });
          }
          await rec('plan', config.models.planner, 900, 120, 0.0002, 1800);
          yield FINISH_TOOLS;
        } else if (req.messages[0]?.role === 'system' && req.messages[0].content === ARTIFACT_SYSTEM) {
          const out = opts.failArtifact ? 'Sorry, I could not build that.' : FAKE_ARTIFACT_HTML;
          for (const part of out.match(/[\s\S]{1,200}/g) ?? []) {
            await delay();
            yield { type: 'text', delta: part };
          }
          await rec('artifact', config.models.planner, 2600, 6500, 0.0014, 38000);
          yield FINISH_STOP;
        } else {
          for (const part of REPORT_TEXT.match(/[\s\S]{1,24}/g) ?? []) {
            await delay();
            yield { type: 'text', delta: part };
          }
          await rec('report', config.models.planner, 4200, 1500, 0.0005, 12000);
          yield FINISH_STOP;
        }
      })(),
    scoreQuery: async (q) => {
      await delay();
      meter.add(0.00001);
      await rec('score_query', config.models.classify, 330, 1, 0.0000132, 900);
      const score = q === 'ai' ? 0.4 : 2.8;
      return { query: q, score, confidence: 0.9, band: score < 1.5 ? 'vague' : 'precise' };
    },
    search: {
      name: 'fake',
      search: async (q) => {
        await delay();
        if (opts.noResults) return [];
        return [
          { url: `https://example.test/${slug(q)}/primary`, title: `Primary source for ${q}`, snippet: '' },
          { url: 'https://example.test/shared/guide?utm_source=x', title: 'Shared guide', snippet: '' },
          { url: 'https://example.test/blocked', title: 'Blocked page', snippet: '' },
          { url: 'https://example.test/offtopic', title: 'Off topic page', snippet: '' },
        ];
      },
    },
    fetchPage: async (url): Promise<FetchedPage> => {
      await delay();
      if (url.includes('/blocked')) throw new FetchError('HTTP 403');
      const marker = url.includes('/offtopic') ? 'OFFTOPIC ' : '';
      return {
        kind: 'markdown',
        url,
        finalUrl: url,
        title: url.includes('/shared/') ? 'Shared guide' : `Page ${slug(url)}`,
        markdown: marker + 'Section-aware chunking keeps clauses together and improves recall for legal retrieval. '.repeat(8),
        contentType: 'text/html',
        bytes: 700,
        truncated: false,
      };
    },
    judgeRelevance: async (_q, text) => {
      await delay();
      meter.add(0.00002);
      await rec('judge_relevance', config.models.classify, 2400, 1, 0.000096, 1100);
      return text.startsWith('OFFTOPIC') ? { relevance: 0.05, relevant: false } : { relevance: 0.92, relevant: true };
    },
    summarize: async (input) => {
      await delay();
      meter.add(0.00004);
      await rec('summarize', config.models.summarize, 2600, 180, 0.0000361, 6000);
      return { text: `Summary: ${(input.text ?? 'document').slice(0, 60)}`, costUsd: 0.00004 };
    },
    recordPage: async () => {},
    tldr: async () => {
      await delay();
      if (opts.failTldr) throw new Error('tldr unavailable');
      meter.add(0.00002);
      await rec('tldr', config.models.extract, 1500, 90, 0.0000236, 2500);
      return { text: 'Section-aware chunking helps legal RAG retrieve whole clauses with their context.', costUsd: 0.00002 };
    },
  };
}
