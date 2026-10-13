import { describe, it, expect } from 'vitest';
import { checkQuota } from '@/lib/limits/quota';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const cfg = loadConfig({});
const now = new Date('2026-10-13T12:00:00Z');
const today = new Date('2026-10-13T01:00:00Z');
const yesterday = new Date('2026-10-12T23:00:00Z');

async function runs(db: any, n: number, opts: { deviceId: string; ipHash: string; startedAt: Date }) {
  for (let i = 0; i < n; i++) await seedRun(db, opts);
}

describe('checkQuota', () => {
  it('allows a device up to its daily limit and blocks the next run', async () => {
    const db = await testDb();
    await runs(db, 4, { deviceId: 'd1', ipHash: 'h1', startedAt: today });
    expect(await checkQuota(db, cfg, { deviceId: 'd1', ipHash: 'h1' }, now)).toEqual({ ok: true });
    await runs(db, 1, { deviceId: 'd1', ipHash: 'h1', startedAt: today });
    expect(await checkQuota(db, cfg, { deviceId: 'd1', ipHash: 'h1' }, now)).toEqual({ ok: false, reason: 'device', limit: 5 });
  });

  it("does not count yesterday's runs (UTC day)", async () => {
    const db = await testDb();
    await runs(db, 5, { deviceId: 'd1', ipHash: 'h1', startedAt: yesterday });
    expect(await checkQuota(db, cfg, { deviceId: 'd1', ipHash: 'h1' }, now)).toEqual({ ok: true });
  });

  it('blocks by IP across many devices at 3x the device limit, so clearing cookies does not reset it', async () => {
    const db = await testDb();
    for (let d = 0; d < 5; d++) await runs(db, 3, { deviceId: `d${d}`, ipHash: 'shared', startedAt: today });
    expect(await checkQuota(db, cfg, { deviceId: 'brand-new', ipHash: 'shared' }, now)).toEqual({ ok: false, reason: 'ip', limit: 15 });
    expect(await checkQuota(db, cfg, { deviceId: 'brand-new', ipHash: 'other' }, now)).toEqual({ ok: true });
  });

  it('blocks the same device even after it changes IP', async () => {
    const db = await testDb();
    await runs(db, 3, { deviceId: 'd1', ipHash: 'home', startedAt: today });
    await runs(db, 2, { deviceId: 'd1', ipHash: 'cafe', startedAt: today });
    expect((await checkQuota(db, cfg, { deviceId: 'd1', ipHash: 'new-ip' }, now)).ok).toBe(false);
  });
});
