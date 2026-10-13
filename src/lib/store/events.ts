import type { RunEvent } from '@/lib/events/schema';
import type { Db } from './db';
import { jsonParam } from './util';

export async function insertEvent(db: Db, ev: RunEvent): Promise<void> {
  await db.query(
    `insert into events(run_id, seq, type, payload, ts) values ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0))`,
    [ev.runId, ev.seq, ev.type, jsonParam(ev), ev.ts],
  );
}

export async function listEvents(db: Db, runId: string, afterSeq = 0): Promise<RunEvent[]> {
  const rows = await db.query<{ payload: unknown }>(
    `select payload from events where run_id = $1 and seq > $2 order by seq`,
    [runId, afterSeq],
  );
  return rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as RunEvent);
}
