import { describe, it, expect } from 'vitest';
import { withTimeout } from '@/lib/http/timeout';
import { isRetryable } from '@/lib/http/retry';
import { postJson } from '@/lib/http/postJson';
import { createTavilySearch } from '@/lib/search/tavily';
import { hang, makeFetch, testCtx } from '../helpers/http';

const nameOf = (e: unknown) => (e as { name?: string })?.name;
const usage = () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

describe('withTimeout', () => {
  it('aborts with a TimeoutError after the delay', async () => {
    const s = withTimeout(undefined, 15);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.aborted).toBe(true);
    expect(nameOf(s.reason)).toBe('TimeoutError');
  });

  it('follows an outer abort first (the run time limit), keeping its AbortError', () => {
    const outer = new AbortController();
    const s = withTimeout(outer.signal, 10_000);
    outer.abort();
    expect(s.aborted).toBe(true);
    expect(nameOf(s.reason)).toBe('AbortError');
  });
});

describe('timeouts are retryable, run aborts are not', () => {
  it('classifies them', () => {
    expect(isRetryable(new DOMException('slow', 'TimeoutError'))).toBe(true);
    expect(isRetryable(new DOMException('stop', 'AbortError'))).toBe(false);
  });
});

describe('REVIEW (final): no upstream call can hang forever', () => {
  it('postJson gives up after ctx.timeoutMs', async () => {
    const { ctx, records } = testCtx(hang);
    ctx.timeoutMs = 20;
    const started = Date.now();
    await expect(postJson({ ctx, path: '/x', body: {}, stage: 'summarize', model: 'm', usage })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(records).toHaveLength(1); // the failed attempt is still recorded
  });

  it('Tavily search gives up after its timeout', async () => {
    const { fetchImpl } = makeFetch(hang);
    const search = createTavilySearch({ apiKey: 'k', fetchImpl, timeoutMs: 20 });
    await expect(search.search('q', { maxResults: 3 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
