import { describe, it, expect } from 'vitest';
import { withRetry, isRetryable } from '@/lib/http/retry';
import { HttpError } from '@/lib/http/errors';

const noSleep = async () => {};

describe('withRetry', () => {
  it('retries a 500 and then succeeds', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        if (++n === 1) throw new HttpError(500, 'oops');
        return 'ok';
      },
      { retries: 2, baseMs: 1, sleep: noSleep },
    );
    expect(out).toBe('ok');
    expect(n).toBe(2);
  });

  it('retries 429 and network TypeErrors', () => {
    expect(isRetryable(new HttpError(429, ''))).toBe(true);
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
  });

  it('does not retry a 400 or an abort', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new HttpError(400, 'bad'); }, { retries: 3, baseMs: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(n).toBe(1);
    expect(isRetryable(new DOMException('aborted', 'AbortError'))).toBe(false);
  });

  it('gives up after the configured retries and rethrows the last error', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new HttpError(503, 'down'); }, { retries: 2, baseMs: 1, sleep: noSleep }),
    ).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(3);
  });

  it('backs off exponentially with jitter', async () => {
    const waits: number[] = [];
    await expect(
      withRetry(async () => { throw new HttpError(500, ''); }, {
        retries: 2, baseMs: 100, random: () => 0.5, sleep: async (ms) => { waits.push(ms); },
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(waits).toEqual([100, 200]);
  });
});
