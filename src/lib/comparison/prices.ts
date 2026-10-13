import type { PriceMap } from './types';

export interface PriceSnapshot {
  fetchedAt: string | null;
  prices: PriceMap;
}

interface Options {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  /** How long to wait for the live listing before using the snapshot. */
  timeoutMs?: number;
  /** How long a failed fetch is remembered, so a down upstream is not retried on every request. */
  failureTtlMs?: number;
  now?: () => number;
  snapshot: PriceSnapshot;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function createPriceProvider(opts: Options) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? SIX_HOURS;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const failureTtlMs = opts.failureTtlMs ?? 60_000;
  let cache: { at: number; asOf: string; all: PriceMap } | null = null;
  let failedAt: number | null = null;

  async function load(): Promise<{ asOf: string | null; all: PriceMap }> {
    if (cache && now() - cache.at < ttlMs) return { asOf: cache.asOf, all: cache.all };
    if (failedAt !== null && now() - failedAt < failureTtlMs) return { asOf: opts.snapshot.fetchedAt, all: {} };
    try {
      const res = await fetchImpl('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
      const all: PriceMap = {};
      for (const m of json.data ?? []) {
        const pin = Number(m.pricing?.prompt);
        const pout = Number(m.pricing?.completion);
        if (Number.isFinite(pin) && Number.isFinite(pout) && m.pricing?.prompt !== '' && m.pricing?.completion !== '') {
          all[m.id] = { in: pin, out: pout };
        }
      }
      const asOf = new Date(now()).toISOString();
      cache = { at: now(), asOf, all };
      failedAt = null;
      return { asOf, all };
    } catch {
      failedAt = now();
      return { asOf: opts.snapshot.fetchedAt, all: {} };
    }
  }

  return {
    async get(ids: string[]): Promise<{ prices: PriceMap; asOf: string | null }> {
      const live = await load();
      const prices: PriceMap = {};
      let usedSnapshot = false;
      for (const id of ids) {
        const p = live.all[id] ?? opts.snapshot.prices[id];
        if (!p) continue;
        if (!live.all[id]) usedSnapshot = true;
        prices[id] = p;
      }
      // Report the oldest source actually used: one snapshot price makes the table only as fresh as the snapshot.
      return { prices, asOf: usedSnapshot ? opts.snapshot.fetchedAt : live.asOf };
    },
  };
}
