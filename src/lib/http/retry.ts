import { HttpError } from './errors';

export interface RetryOpts {
  retries: number;
  baseMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  if ((err as { name?: string } | null)?.name === 'TimeoutError') return true; // a hung call, not a run abort
  return err instanceof TypeError; // fetch network failure
}

export async function withRetry<T>(fn: () => Promise<T>, o: RetryOpts): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= o.retries || !isRetryable(err)) throw err;
      await sleep(o.baseMs * 2 ** attempt * (0.5 + random()));
    }
  }
}
