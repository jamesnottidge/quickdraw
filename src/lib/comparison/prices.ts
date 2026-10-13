import type { PriceMap } from './types';

export interface PriceSnapshot {
  fetchedAt: string | null;
  prices: PriceMap;
}

interface Options {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  snapshot: PriceSnapshot;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function createPriceProvider(opts: Options) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? SIX_HOURS;
  const now = opts.now ?? Date.now;
  let cache: { at: number; asOf: string; all: PriceMap } | null = null;

  async function load(): Promise<{ asOf: string | null; all: PriceMap }> {
    if (cache && now() - cache.at < ttlMs) return { asOf: cache.asOf, all: cache.all };
    try {
      const res = await fetchImpl('https://openrouter.ai/api/v1/models');
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
      return { asOf, all };
    } catch {
      return { asOf: opts.snapshot.fetchedAt, all: {} };
    }
  }

  return {
    async get(ids: string[]): Promise<{ prices: PriceMap; asOf: string | null }> {
      const live = await load();
      const prices: PriceMap = {};
      for (const id of ids) {
        const p = live.all[id] ?? opts.snapshot.prices[id];
        if (p) prices[id] = p;
      }
      return { prices, asOf: live.asOf };
    },
  };
}
