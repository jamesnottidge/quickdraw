import { describe, it, expect } from 'vitest';
import { getRunList } from '@/lib/server/runList';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const config = loadConfig({});
const now = new Date('2026-10-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('getRunList', () => {
  it('returns only the caller\'s device, newest first, with the fields the sidebar needs', async () => {
    const db = await testDb();
    const a1 = await seedRun(db, { deviceId: 'dev-A', ipHash: 'x', startedAt: minutesAgo(30), status: 'finished' });
    const a2 = await seedRun(db, { deviceId: 'dev-A', ipHash: 'y', startedAt: minutesAgo(10), status: 'failed' }); // other IP, same device
    const a3 = await seedRun(db, { deviceId: 'dev-A', ipHash: 'x', startedAt: minutesAgo(20), status: 'finished' });
    await seedRun(db, { deviceId: 'dev-B', ipHash: 'x', startedAt: minutesAgo(5), status: 'finished' });
    const list = await getRunList(db, config, 'dev-A', now);
    expect(list.map((r) => r.id)).toEqual([a2.runId, a3.runId, a1.runId]);
    expect(list[0]).toEqual({ id: a2.runId, prompt: 'p', status: 'failed', startedAt: minutesAgo(10).toISOString() });
  });

  it('REVIEW FOCUS: no device id, or a device with no runs, yields an empty list (never someone else\'s)', async () => {
    const db = await testDb();
    await seedRun(db, { deviceId: 'dev-A' });
    expect(await getRunList(db, config, undefined, now)).toEqual([]);
    expect(await getRunList(db, config, 'dev-unknown', now)).toEqual([]);
  });

  it('limits the list to 50 entries', async () => {
    const db = await testDb();
    for (let i = 0; i < 55; i++) await seedRun(db, { deviceId: 'dev-A', startedAt: minutesAgo(i + 1) });
    const list = await getRunList(db, config, 'dev-A', now);
    expect(list).toHaveLength(50);
    expect(new Date(list[0].startedAt).getTime()).toBeGreaterThan(new Date(list[49].startedAt).getTime());
  });

  it('reaps stale running runs so they do not show as running forever', async () => {
    const db = await testDb();
    const stale = await seedRun(db, { deviceId: 'dev-A', status: 'running', startedAt: minutesAgo(15) });
    const fresh = await seedRun(db, { deviceId: 'dev-A', status: 'running', startedAt: minutesAgo(1) });
    const list = await getRunList(db, config, 'dev-A', now);
    expect(list.find((r) => r.id === stale.runId)!.status).toBe('failed');
    expect(list.find((r) => r.id === fresh.runId)!.status).toBe('running');
  });
});
