import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getReplay } from '@/lib/server/replay';
import { insertEvent } from '@/lib/store/events';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const config = loadConfig({});
const now = new Date('2026-10-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

async function started(db: any, runId: string, n: number) {
  for (let i = 1; i <= n; i++) {
    await insertEvent(db, i === 1
      ? { runId, seq: 1, ts: now.getTime(), type: 'run_started', prompt: 'p' }
      : { runId, seq: i, ts: now.getTime(), type: 'search_started', query: `q${i}` });
  }
}

describe('getReplay', () => {
  it('REVIEW (final): a run killed by the platform replays as failed, not as an endless "working" run', async () => {
    const db = await testDb();
    const { runId } = await seedRun(db, { status: 'running', startedAt: minutesAgo(10) });
    await started(db, runId, 2);
    const replay = await getReplay(db, config, runId, now);
    expect(replay!.run.status).toBe('failed');
    expect(replay!.active).toBe(false);
    expect(replay!.events.at(-1)).toMatchObject({ seq: 3, type: 'run_failed', message: expect.stringMatching(/terminated/i) });
  });

  it('keeps a genuinely in-progress run active', async () => {
    const db = await testDb();
    const { runId } = await seedRun(db, { status: 'running', startedAt: minutesAgo(1) });
    await started(db, runId, 2);
    const replay = await getReplay(db, config, runId, now);
    expect(replay!.run.status).toBe('running');
    expect(replay!.active).toBe(true);
    expect(replay!.events).toHaveLength(2);
  });

  it('reports a finished run as inactive and an unknown id as null', async () => {
    const db = await testDb();
    const { runId } = await seedRun(db, { status: 'finished', startedAt: minutesAgo(30) });
    await insertEvent(db, { runId, seq: 1, ts: 1, type: 'run_finished', costUsd: 0 });
    expect((await getReplay(db, config, runId, now))!.active).toBe(false);
    expect(await getReplay(db, config, randomUUID(), now)).toBeNull();
  });
});
