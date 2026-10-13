import { describe, it, expect } from 'vitest';
import { gather, type GatherDeps } from '@/lib/pipeline/gather';
import type { FetchedPage } from '@/lib/fetch/fetchPage';
import { FetchError } from '@/lib/fetch/errors';
import { HttpError } from '@/lib/http/errors';
import { loadConfig } from '@/lib/config';
import type { PageRecord } from '@/lib/store/pages';
import { drain } from '../helpers/gen';

const config = loadConfig({});

const md = (url: string, text = 'x'.repeat(500)): FetchedPage => ({
  kind: 'markdown', url, finalUrl: url, title: `Title ${url}`, markdown: text, contentType: 'text/html', bytes: text.length, truncated: false,
});

function makeDeps(over: Partial<GatherDeps> & { results?: Record<string, { url: string; title: string }[]> } = {}) {
  const fetched: string[] = [];
  const summarized: any[] = [];
  const judged: string[] = [];
  const recorded: PageRecord[] = [];
  const results = over.results ?? {};
  const deps: GatherDeps = {
    config,
    search: {
      name: 'fake',
      search: async (q) => (results[q] ?? []).map((r) => ({ ...r, snippet: '' })),
    },
    fetchPage: async (url) => {
      fetched.push(url);
      return md(url);
    },
    judgeRelevance: async (_q, text) => {
      judged.push(text);
      return { relevance: 0.9, relevant: true };
    },
    summarize: async (input) => {
      summarized.push(input);
      return { text: `summary of ${(input.text ?? 'binary').slice(0, 8)}`, costUsd: 0 };
    },
    recordPage: async (p) => {
      recorded.push(p);
    },
    sleep: async () => {},
    ...over,
  };
  return { deps, fetched, summarized, judged, recorded };
}

const r = (url: string) => ({ url, title: `T ${url}` });
const types = (events: { type: string }[]) => events.map((e) => e.type);

describe('gather', () => {
  it('searches every query, dedupes URLs across queries (ignoring tracking params) and fetches each once', async () => {
    const { deps, fetched } = makeDeps({
      results: {
        q1: [r('https://a.test/x?utm_source=n'), r('https://b.test/y')],
        q2: [r('https://a.test/x'), r('https://c.test/z')],
      },
    });
    const { events } = await drain(gather('question', ['q1', 'q2'], deps));
    expect(fetched.sort()).toEqual(['https://a.test/x?utm_source=n', 'https://b.test/y', 'https://c.test/z']);
    for (const q of ['q1', 'q2']) {
      const started = events.findIndex((e) => e.type === 'search_started' && (e as any).query === q);
      const done = events.findIndex((e) => e.type === 'search_results' && (e as any).query === q);
      expect(started).toBeGreaterThanOrEqual(0);
      expect(started).toBeLessThan(done);
    }
  });

  it('turns a failed fetch into page_failed and keeps going', async () => {
    const { deps, recorded } = makeDeps({
      results: { q: [r('https://bad.test/'), r('https://ok.test/')] },
      fetchPage: async (url) => {
        if (url.includes('bad')) throw new FetchError('HTTP 403');
        return md(url);
      },
    });
    const { events, result } = await drain(gather('question', ['q'], deps));
    expect(events).toContainEqual({ type: 'page_failed', url: 'https://bad.test/', reason: 'HTTP 403' });
    expect(result.map((s) => s.url)).toEqual(['https://ok.test/']);
    expect(recorded).toContainEqual(expect.objectContaining({ url: 'https://bad.test/', fetchStatus: 'failed', error: 'HTTP 403' }));
    expect(recorded).toContainEqual(expect.objectContaining({ url: 'https://ok.test/', fetchStatus: 'ok' }));
  });

  it('only summarizes pages judged relevant, in search-rank order', async () => {
    const { deps, summarized } = makeDeps({
      results: { q: [r('https://slow.test/'), r('https://irrelevant.test/'), r('https://fast.test/')] },
      fetchPage: async (url) => {
        if (url.includes('slow')) await new Promise((res) => setTimeout(res, 30));
        return md(url, `${url} ${'y'.repeat(400)}`);
      },
      judgeRelevance: async (_q, text) =>
        text.includes('irrelevant') ? { relevance: 0.05, relevant: false } : { relevance: 0.9, relevant: true },
    });
    const { events, result } = await drain(gather('question', ['q'], deps));
    expect(summarized).toHaveLength(2);
    expect(result.map((s) => s.url)).toEqual(['https://slow.test/', 'https://fast.test/']);
    expect(events).toContainEqual({ type: 'page_judged', url: 'https://irrelevant.test/', relevance: 0.05, relevant: false });
    expect(events.filter((e) => e.type === 'summary_done')).toHaveLength(2);
  });

  it('passes the research question to the summarizer instruction', async () => {
    const { deps, summarized } = makeDeps({ results: { q: [r('https://a.test/')] } });
    await drain(gather('How do bees navigate?', ['q'], deps));
    expect(summarized[0].instruction).toContain('How do bees navigate?');
    expect(summarized[0].text).toHaveLength(500);
  });

  it('summarizes a binary document first and judges relevance on that summary', async () => {
    const { deps, summarized, judged } = makeDeps({
      results: { q: [r('https://a.test/report.pdf')] },
      fetchPage: async (url) => ({
        kind: 'binary', url, finalUrl: url, mime: 'application/pdf', contentType: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAAA', filename: 'report.pdf', bytes: 4,
      }),
    });
    const { result } = await drain(gather('question', ['q'], deps));
    expect(summarized).toHaveLength(1);
    expect(summarized[0].binary).toEqual({ mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA', filename: 'report.pdf' });
    expect(judged).toEqual(['summary of binary']);
    expect(result).toHaveLength(1);
  });

  it('caps fetched pages at limits.maxPages', async () => {
    const many = Array.from({ length: 45 }, (_, i) => r(`https://s.test/${i}`));
    const { deps, fetched } = makeDeps({ results: { q: many } });
    await drain(gather('question', ['q'], deps));
    expect(fetched).toHaveLength(config.limits.maxPages);
  });

  it('retries a transient classify failure once, then gives up on that page only', async () => {
    let calls = 0;
    const flaky = makeDeps({
      results: { q: [r('https://a.test/')] },
      judgeRelevance: async () => {
        if (++calls === 1) throw new HttpError(503, 'down');
        return { relevance: 0.9, relevant: true };
      },
    });
    expect((await drain(gather('question', ['q'], flaky.deps))).result).toHaveLength(1);

    const dead = makeDeps({
      results: { q: [r('https://a.test/'), r('https://b.test/')] },
      judgeRelevance: async (_q, text) => {
        if (text.length === 500) throw new HttpError(503, 'down');
        return { relevance: 0.9, relevant: true };
      },
    });
    const { events, result } = await drain(gather('question', ['q'], dead.deps));
    expect(result).toHaveLength(0);
    expect(events.filter((e) => e.type === 'page_failed' && (e as any).reason === 'Could not analyse this page')).toHaveLength(2);
    // the provider's raw error body never reaches the trace
    expect(JSON.stringify(events)).not.toMatch(/HTTP 503|down/);
  });

  it('skips a page with no readable text without calling any model', async () => {
    const { deps, judged, summarized } = makeDeps({
      results: { q: [r('https://empty.test/'), r('https://blank.test/')] },
      fetchPage: async (url) => md(url, url.includes('empty') ? '' : '   \n  '),
    });
    const { events, result } = await drain(gather('question', ['q'], deps));
    expect(result).toHaveLength(0);
    expect(judged).toHaveLength(0);
    expect(summarized).toHaveLength(0);
    expect(events.filter((e) => e.type === 'page_failed').map((e) => (e as any).reason)).toEqual([
      'No readable text on this page',
      'No readable text on this page',
    ]);
  });

  it('treats a search failure as zero results and returns no summaries', async () => {
    const { deps } = makeDeps({
      search: { name: 'broken', search: async () => { throw new HttpError(500, 'no'); } },
    });
    const { events, result } = await drain(gather('question', ['q'], deps));
    expect(result).toEqual([]);
    expect(events).toContainEqual({ type: 'search_results', query: 'q', results: [] });
  });

  it('does nothing for an empty query list', async () => {
    const { deps } = makeDeps();
    const { events, result } = await drain(gather('question', [], deps));
    expect(events).toEqual([]);
    expect(result).toEqual([]);
  });

  it('skips fetching when the run has been aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const { deps, fetched } = makeDeps({ results: { q: [r('https://a.test/')] }, signal: ac.signal });
    const { result } = await drain(gather('question', ['q'], deps));
    expect(fetched).toEqual([]);
    expect(result).toEqual([]);
  });

  it('emits page_fetched with a character count before judging', async () => {
    const { deps } = makeDeps({ results: { q: [r('https://a.test/')] } });
    const { events } = await drain(gather('question', ['q'], deps));
    const order = types(events.filter((e) => ['page_fetched', 'page_judged', 'summary_done'].includes(e.type)));
    expect(order).toEqual(['page_fetched', 'page_judged', 'summary_done']);
    expect(events.find((e) => e.type === 'page_fetched')).toMatchObject({ chars: 500, contentType: 'text/html' });
  });
});
