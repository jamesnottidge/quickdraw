import { randomUUID } from 'node:crypto';
import { createPgliteDb } from '@/lib/store/pglite';
import type { Db } from '@/lib/store/db';
import { migrate } from '@/lib/store/migrate';

export async function testDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}

export async function seedRun(
  db: Db,
  opts: {
    deviceId?: string;
    ipHash?: string;
    startedAt?: Date;
    status?: 'running' | 'finished' | 'failed';
    reservedUsd?: number;
    reservedSearches?: number;
    ledgerDay?: string;
  } = {},
): Promise<{ sessionId: string; runId: string }> {
  const [s] = await db.query<{ id: string }>(
    `insert into sessions(device_id, ip_hash) values ($1, $2)
     on conflict (device_id, ip_hash) do update set last_seen = now() returning id`,
    [opts.deviceId ?? 'dev-1', opts.ipHash ?? 'ip-1'],
  );
  const runId = randomUUID();
  await db.query(
    `insert into runs(id, session_id, prompt, status, config, started_at, reserved_usd, reserved_searches, ledger_day)
     values ($1, $2, 'p', $3, '{}'::jsonb, $4::timestamptz, $5, $6, $7::date)`,
    [
      runId,
      s.id,
      opts.status ?? 'finished',
      (opts.startedAt ?? new Date()).toISOString(),
      opts.reservedUsd ?? 0,
      opts.reservedSearches ?? 0,
      opts.ledgerDay ?? (opts.startedAt ?? new Date()).toISOString().slice(0, 10),
    ],
  );
  return { sessionId: s.id, runId };
}
