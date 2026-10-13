import type { AppConfig } from '@/lib/config';
import type { Db } from '@/lib/store/db';

export type QuotaResult = { ok: true } | { ok: false; reason: 'device' | 'ip'; limit: number };

export async function checkQuota(
  db: Db,
  cfg: AppConfig,
  who: { deviceId: string; ipHash: string },
  now = new Date(),
): Promise<QuotaResult> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [row] = await db.query<{ device_runs: number; ip_runs: number }>(
    `select
       (select count(*)::int from runs r join sessions s on s.id = r.session_id
         where s.device_id = $1 and r.started_at >= $3::timestamptz) as device_runs,
       (select count(*)::int from runs r join sessions s on s.id = r.session_id
         where s.ip_hash = $2 and r.started_at >= $3::timestamptz) as ip_runs`,
    [who.deviceId, who.ipHash, dayStart],
  );
  const deviceLimit = cfg.limits.runsPerDevicePerDay;
  const ipLimit = deviceLimit * cfg.limits.ipMultiplier;
  if (Number(row.device_runs) >= deviceLimit) return { ok: false, reason: 'device', limit: deviceLimit };
  if (Number(row.ip_runs) >= ipLimit) return { ok: false, reason: 'ip', limit: ipLimit };
  return { ok: true };
}
