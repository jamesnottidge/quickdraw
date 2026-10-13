import { describe, it, expect } from 'vitest';
import { claimQuota, releaseQuota } from '@/lib/limits/quota';
import { loadConfig } from '@/lib/config';
import { testDb } from '../helpers/db';

const cfg = loadConfig({});
const day1 = new Date('2026-10-13T12:00:00Z');
const day2 = new Date('2026-10-14T00:00:01Z');

async function claim(db: any, n: number, who: { deviceId: string; ipHash: string }, now = day1) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await claimQuota(db, cfg, who, now));
  return out;
}

describe('claimQuota', () => {
  it('allows a device up to its daily limit and blocks the next claim', async () => {
    const db = await testDb();
    const who = { deviceId: 'd1', ipHash: 'h1' };
    expect((await claim(db, 5, who)).every((r) => r.ok)).toBe(true);
    expect(await claimQuota(db, cfg, who, day1)).toEqual({ ok: false, reason: 'device', limit: 5 });
  });

  it('resets on the next UTC day', async () => {
    const db = await testDb();
    const who = { deviceId: 'd1', ipHash: 'h1' };
    await claim(db, 5, who, day1);
    expect(await claimQuota(db, cfg, who, day2)).toEqual({ ok: true });
  });

  it('blocks by IP across many devices at 3x the device limit, so clearing cookies does not reset it', async () => {
    const db = await testDb();
    for (let d = 0; d < 5; d++) await claim(db, 3, { deviceId: `d${d}`, ipHash: 'shared' });
    expect(await claimQuota(db, cfg, { deviceId: 'brand-new', ipHash: 'shared' }, day1)).toEqual({ ok: false, reason: 'ip', limit: 15 });
    // the refused attempt must not have consumed the new device's own slots
    expect((await claim(db, 5, { deviceId: 'brand-new', ipHash: 'elsewhere' })).every((r) => r.ok)).toBe(true);
  });

  it('blocks the same device even after it changes IP', async () => {
    const db = await testDb();
    await claim(db, 3, { deviceId: 'd1', ipHash: 'home' });
    await claim(db, 2, { deviceId: 'd1', ipHash: 'cafe' });
    expect(await claimQuota(db, cfg, { deviceId: 'd1', ipHash: 'new-ip' }, day1)).toMatchObject({ ok: false, reason: 'device' });
  });

  it('releaseQuota gives the slots back', async () => {
    const db = await testDb();
    const who = { deviceId: 'd1', ipHash: 'h1' };
    await claim(db, 5, who);
    await releaseQuota(db, who, day1);
    expect(await claimQuota(db, cfg, who, day1)).toEqual({ ok: true });
    expect(await claimQuota(db, cfg, who, day1)).toMatchObject({ ok: false });
  });

  it('REVIEW (final): a burst of simultaneous claims cannot exceed the limit', async () => {
    const db = await testDb();
    const who = { deviceId: 'burst', ipHash: 'h-burst' };
    const results = await Promise.all(Array.from({ length: 40 }, () => claimQuota(db, cfg, who, day1)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});
