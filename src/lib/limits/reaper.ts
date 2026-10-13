import type { AppConfig } from '@/lib/config';
import type { Db } from '@/lib/store/db';
import { insertEvent } from '@/lib/store/events';
import { finishRun } from '@/lib/store/runs';
import { sumRunCost } from '@/lib/store/modelCalls';
import { settle } from './budget';

/** Fails runs whose function was killed before it could settle, and releases their reservations. */
export async function reapStaleRuns(db: Db, cfg: AppConfig, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - cfg.maxFunctionMs - cfg.reaperMarginMs).toISOString();
  const stale = await db.query<{ id: string }>(
    `select id from runs where status = 'running' and settled = false and started_at < $1::timestamptz`,
    [cutoff],
  );
  for (const { id } of stale) {
    const cost = await sumRunCost(db, id);
    const [{ n }] = await db.query<{ n: number }>(
      `select count(*)::int as n from events where run_id = $1 and type = 'search_started'`,
      [id],
    );
    const message = 'The run was terminated before it could finish (function time limit).';
    // A terminal event lets a replay show "failed" instead of an endless "working" run.
    try {
      const [{ last }] = await db.query<{ last: number }>(
        `select coalesce(max(seq), 0)::int as last from events where run_id = $1`,
        [id],
      );
      await insertEvent(db, { runId: id, seq: Number(last) + 1, ts: now.getTime(), type: 'run_failed', message });
    } catch (e) {
      console.error('reaper could not write a terminal event', e);
    }
    await finishRun(db, id, { status: 'failed', costUsd: cost, error: message });
    await settle(db, id, { actualUsd: cost, searchesUsed: Number(n) });
  }
  return stale.length;
}
