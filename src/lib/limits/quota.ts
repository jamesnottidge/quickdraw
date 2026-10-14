import type { AppConfig } from '@/lib/config';
import type { Db } from '@/lib/store/db';

export type QuotaClaim = { ok: true } | { ok: false; reason: 'device' | 'ip'; limit: number };

type Who = { deviceId: string; ipHash: string };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const deviceKey = (w: Who) => `device:${w.deviceId}`;
const ipKey = (w: Who) => `ip:${w.ipHash}`;

/** One conditional upsert per key: it increments only while the counter is under the limit. */
async function claim(db: Db, day: string, key: string, limit: number): Promise<boolean> {
  const rows = await db.query(
    `insert into quota_usage(day, key, count) values ($1::date, $2, 1)
     on conflict (day, key) do update set count = quota_usage.count + 1
       where quota_usage.count < $3::int
     returning count`,
    [day, key, limit],
  );
  return rows.length > 0;
}

export async function releaseQuota(db: Db, who: Who, now = new Date()): Promise<void> {
  await db.query(
    `update quota_usage set count = greatest(count - 1, 0) where day = $1::date and key in ($2, $3)`,
    [utcDay(now), deviceKey(who), ipKey(who)],
  );
}

/**
 * Claims one run for this device and this network for the UTC day. The IP limit is a multiple of
 * the device limit so a shared office or school network is not locked out by one heavy user.
 * Call releaseQuota if the run does not start.
 */
export async function claimQuota(db: Db, cfg: AppConfig, who: Who, now = new Date()): Promise<QuotaClaim> {
  const day = utcDay(now);
  const deviceLimit = cfg.limits.runsPerDevicePerDay;
  const ipLimit = deviceLimit * cfg.limits.ipMultiplier;
  if (!(await claim(db, day, deviceKey(who), deviceLimit))) return { ok: false, reason: 'device', limit: deviceLimit };
  if (!(await claim(db, day, ipKey(who), ipLimit))) {
    await db.query(`update quota_usage set count = greatest(count - 1, 0) where day = $1::date and key = $2`, [day, deviceKey(who)]);
    return { ok: false, reason: 'ip', limit: ipLimit };
  }
  return { ok: true };
}

/** Chat replies (messages that are not research) have their own, looser per-device daily cap. */
export async function claimChat(db: Db, cfg: AppConfig, who: Who, now = new Date()): Promise<boolean> {
  return claim(db, utcDay(now), `chat:${deviceKey(who)}`, cfg.limits.chatsPerDevicePerDay);
}
