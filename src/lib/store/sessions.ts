import type { Db } from './db';

export async function upsertSession(
  db: Db,
  s: { deviceId: string; ipHash: string; userAgent?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into sessions(device_id, ip_hash, user_agent) values ($1, $2, $3)
     on conflict (device_id, ip_hash)
     do update set last_seen = now(), user_agent = coalesce(excluded.user_agent, sessions.user_agent)
     returning id`,
    [s.deviceId, s.ipHash, s.userAgent ?? null],
  );
  return rows[0].id;
}
