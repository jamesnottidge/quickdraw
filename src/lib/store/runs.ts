import type { Db } from './db';
import { cleanText, jsonParam } from './util';

export interface RunRow {
  id: string;
  session_id: string;
  prompt: string;
  status: 'running' | 'finished' | 'failed';
  config: unknown;
  started_at: Date;
  finished_at: Date | null;
  cost_usd: number;
  error: string | null;
  reserved_usd: number;
  reserved_searches: number;
  ledger_day: string;
  settled: boolean;
}

const COLUMNS = `id, session_id, prompt, status, config, started_at, finished_at,
  cost_usd::float8 as cost_usd, error, reserved_usd::float8 as reserved_usd, reserved_searches,
  ledger_day::text as ledger_day, settled`;

export async function createRun(
  db: Db,
  r: {
    id: string;
    sessionId: string;
    prompt: string;
    config: unknown;
    reservedUsd: number;
    reservedSearches: number;
    ledgerDay: string;
    startedAt?: Date;
  },
): Promise<void> {
  await db.query(
    `insert into runs(id, session_id, prompt, status, config, reserved_usd, reserved_searches, ledger_day, started_at)
     values ($1, $2, $3, 'running', $4::jsonb, $5, $6, $7::date, $8::timestamptz)`,
    [
      r.id,
      r.sessionId,
      cleanText(r.prompt),
      jsonParam(r.config),
      r.reservedUsd,
      r.reservedSearches,
      r.ledgerDay,
      (r.startedAt ?? new Date()).toISOString(),
    ],
  );
}

export async function finishRun(
  db: Db,
  id: string,
  r: { status: 'finished' | 'failed'; costUsd: number; error?: string },
): Promise<void> {
  await db.query(
    `update runs set status = $2, cost_usd = $3, error = $4, finished_at = now() where id = $1`,
    [id, r.status, r.costUsd, r.error ? cleanText(r.error) : null],
  );
}

export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  const rows = await db.query<RunRow>(`select ${COLUMNS} from runs where id = $1`, [id]);
  return rows[0] ?? null;
}

export interface RunListItem {
  id: string;
  prompt: string;
  status: 'running' | 'finished' | 'failed';
  startedAt: string;
}

/** The runs started from one device (any IP), newest first. */
export async function listRunsForDevice(db: Db, deviceId: string, limit = 50): Promise<RunListItem[]> {
  const rows = await db.query<{ id: string; prompt: string; status: RunListItem['status']; started_at: Date | string }>(
    `select r.id, r.prompt, r.status, r.started_at
       from runs r join sessions s on s.id = r.session_id
      where s.device_id = $1
      order by r.started_at desc
      limit $2`,
    [deviceId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status,
    startedAt: new Date(r.started_at).toISOString(),
  }));
}
