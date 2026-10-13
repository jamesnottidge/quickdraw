import { describe, it, expect } from 'vitest';
import { getLedger, releaseReservation, reserve, settle, utcDay } from '@/lib/limits/budget';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const now = new Date('2026-10-13T12:00:00Z');

describe('reserve', () => {
  it('reserves worst-case spend and search calls on the day ledger', async () => {
    const db = await testDb();
    const cfg = loadConfig({});
    const r = await reserve(db, cfg, now);
    expect(r).toEqual({ ok: true, reservation: { day: '2026-10-13', usd: 0.15, searches: 8 } });
    expect(await getLedger(db, '2026-10-13')).toEqual({ reservedUsd: 0.15, actualUsd: 0, searchReserved: 8, searchUsed: 0 });
  });

  it('refuses once the daily spend cap would be exceeded', async () => {
    const db = await testDb();
    const cfg = loadConfig({ DAILY_SPEND_CAP_USD: '0.3' });
    expect((await reserve(db, cfg, now)).ok).toBe(true);
    expect((await reserve(db, cfg, now)).ok).toBe(true);
    expect(await reserve(db, cfg, now)).toEqual({ ok: false, reason: 'spend' });
  });

  it('refuses when the search budget is exhausted even if spend is fine', async () => {
    const db = await testDb();
    const cfg = loadConfig({ SEARCH_BUDGET_PER_DAY: '16' });
    expect((await reserve(db, cfg, now)).ok).toBe(true);
    expect((await reserve(db, cfg, now)).ok).toBe(true);
    expect(await reserve(db, cfg, now)).toEqual({ ok: false, reason: 'search' });
  });

  it('simultaneous starts cannot overshoot the cap', async () => {
    const db = await testDb();
    const cfg = loadConfig({ DAILY_SPEND_CAP_USD: '1' });
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(db, cfg, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(6); // 6 x 0.15 = 0.90 <= 1.00 < 7 x 0.15
    const ledger = await getLedger(db, '2026-10-13');
    expect(ledger!.reservedUsd).toBeCloseTo(0.9, 6);
  });

  it('keeps days separate', async () => {
    const db = await testDb();
    const cfg = loadConfig({ DAILY_SPEND_CAP_USD: '0.15' });
    expect((await reserve(db, cfg, now)).ok).toBe(true);
    expect((await reserve(db, cfg, now)).ok).toBe(false);
    expect((await reserve(db, cfg, new Date('2026-10-14T00:00:01Z'))).ok).toBe(true);
  });
});

describe('releaseReservation', () => {
  it('gives back a reservation that never became a run', async () => {
    const db = await testDb();
    const cfg = loadConfig({});
    const r = await reserve(db, cfg, now);
    if (!r.ok) throw new Error('expected ok');
    await releaseReservation(db, r.reservation);
    expect(await getLedger(db, '2026-10-13')).toEqual({ reservedUsd: 0, actualUsd: 0, searchReserved: 0, searchUsed: 0 });
  });
});

describe('settle', () => {
  it('moves the reservation to actual spend, once', async () => {
    const db = await testDb();
    const cfg = loadConfig({});
    const r = await reserve(db, cfg, now);
    if (!r.ok) throw new Error('expected ok');
    const { runId } = await seedRun(db, { status: 'running', reservedUsd: 0.15, reservedSearches: 8, ledgerDay: '2026-10-13' });
    expect(await settle(db, runId, { actualUsd: 0.02, searchesUsed: 3 })).toBe(true);
    expect(await getLedger(db, '2026-10-13')).toEqual({ reservedUsd: 0, actualUsd: 0.02, searchReserved: 0, searchUsed: 3 });
    expect(await settle(db, runId, { actualUsd: 0.02, searchesUsed: 3 })).toBe(false);
    expect(await getLedger(db, '2026-10-13')).toEqual({ reservedUsd: 0, actualUsd: 0.02, searchReserved: 0, searchUsed: 3 });
  });
});

describe('utcDay', () => {
  it('formats the UTC calendar day', () => {
    expect(utcDay(new Date('2026-10-13T23:59:59Z'))).toBe('2026-10-13');
  });
});
