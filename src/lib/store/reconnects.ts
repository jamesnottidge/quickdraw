import type { Db } from './db';

export async function insertReconnect(
  db: Db,
  r: { runId: string; sessionId: string | null; runActive: boolean },
): Promise<void> {
  await db.query(`insert into reconnects(run_id, session_id, run_active) values ($1, $2, $3)`, [
    r.runId,
    r.sessionId,
    r.runActive,
  ]);
}

export async function countReconnects(db: Db): Promise<{ total: number; whileActive: number }> {
  const rows = await db.query<{ total: number; active: number }>(
    `select count(*)::int as total, count(*) filter (where run_active)::int as active from reconnects`,
  );
  return { total: Number(rows[0].total), whileActive: Number(rows[0].active) };
}
