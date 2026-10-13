import type { AppConfig } from '@/lib/config';
import type { RunEvent } from '@/lib/events/schema';
import { reapStaleRuns } from '@/lib/limits/reaper';
import type { Db } from '@/lib/store/db';
import { listEvents } from '@/lib/store/events';
import { getRun } from '@/lib/store/runs';

export interface Replay {
  run: { id: string; prompt: string; status: 'running' | 'finished' | 'failed' };
  events: RunEvent[];
  active: boolean;
}

/** Stored events for a run. Stale runs (killed functions) are reaped first, so they replay as failed. */
export async function getReplay(db: Db, config: AppConfig, id: string, now = new Date()): Promise<Replay | null> {
  try {
    await reapStaleRuns(db, config, now);
  } catch (e) {
    console.error('reapStaleRuns failed during replay', e);
  }
  const run = await getRun(db, id);
  if (!run) return null;
  const events = await listEvents(db, id);
  const terminal = events.some((e) => e.type === 'run_finished' || e.type === 'run_failed');
  return {
    run: { id: run.id, prompt: run.prompt, status: run.status },
    events,
    active: run.status === 'running' && !terminal,
  };
}
