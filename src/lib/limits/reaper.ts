import type { AppConfig } from '@/lib/config';
import type { Db } from '@/lib/store/db';
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
    await finishRun(db, id, {
      status: 'failed',
      costUsd: cost,
      error: 'The run was terminated before it could finish (function time limit).',
    });
    await settle(db, id, { actualUsd: cost, searchesUsed: Number(n) });
  }
  return stale.length;
}
