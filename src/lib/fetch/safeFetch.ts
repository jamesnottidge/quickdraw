import { Agent, fetch as undiciFetch } from 'undici';
import { createSafeLookup } from './ssrf';

/**
 * A fetch whose TCP connections validate the resolved address at connect time.
 * IP-literal hosts skip DNS entirely, so callers must still run assertSafeUrl first.
 */
export function createSafeFetch(): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: createSafeLookup() as never } });
  return ((input: unknown, init?: Record<string, unknown>) =>
    undiciFetch(input as never, { ...(init ?? {}), dispatcher } as never)) as unknown as typeof fetch;
}
