import type { AppConfig } from '@/lib/config';
import type { Db } from '@/lib/store/db';

export interface Reservation {
  day: string;
  usd: number;
  searches: number;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: 'spend' | 'search' };

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export interface Ledger {
  reservedUsd: number;
  actualUsd: number;
  searchReserved: number;
  searchUsed: number;
}

export async function getLedger(db: Db, day: string): Promise<Ledger | null> {
  const rows = await db.query<any>(
    `select reserved_usd::float8 as r, actual_usd::float8 as a, search_reserved as sr, search_used as su
     from spend_ledger where day = $1::date`,
    [day],
  );
  if (!rows[0]) return null;
  return {
    reservedUsd: Number(rows[0].r),
    actualUsd: Number(rows[0].a),
    searchReserved: Number(rows[0].sr),
    searchUsed: Number(rows[0].su),
  };
}

/** One conditional UPDATE does the check and the increment together, so concurrent starts cannot overshoot. */
export async function reserve(db: Db, cfg: AppConfig, now = new Date()): Promise<ReserveResult> {
  const day = utcDay(now);
  const usd = cfg.limits.reserveUsdPerRun;
  const searches = cfg.limits.reserveSearchesPerRun;
  await db.query(`insert into spend_ledger(day) values ($1::date) on conflict (day) do nothing`, [day]);
  const updated = await db.query(
    `update spend_ledger
        set reserved_usd = reserved_usd + $2::numeric, search_reserved = search_reserved + $3::int
      where day = $1::date
        and reserved_usd + actual_usd + $2::numeric <= $4::numeric
        and search_reserved + search_used + $3::int <= $5::int
      returning day`,
    [day, usd, searches, cfg.limits.dailySpendCapUsd, cfg.limits.dailySearchBudget],
  );
  if (updated.length > 0) return { ok: true, reservation: { day, usd, searches } };
  const ledger = await getLedger(db, day);
  const spendOk = ledger ? ledger.reservedUsd + ledger.actualUsd + usd <= cfg.limits.dailySpendCapUsd + 1e-9 : true;
  return { ok: false, reason: spendOk ? 'search' : 'spend' };
}

export async function releaseReservation(db: Db, r: Reservation): Promise<void> {
  await db.query(
    `update spend_ledger
        set reserved_usd = greatest(reserved_usd - $2::numeric, 0), search_reserved = greatest(search_reserved - $3::int, 0)
      where day = $1::date`,
    [r.day, r.usd, r.searches],
  );
}

/** Idempotent: only the call that flips runs.settled applies the ledger change. */
export async function settle(
  db: Db,
  runId: string,
  a: { actualUsd: number; searchesUsed: number },
): Promise<boolean> {
  const flipped = await db.query<any>(
    `update runs set settled = true where id = $1 and settled = false
     returning reserved_usd::float8 as reserved_usd, reserved_searches, ledger_day::text as ledger_day`,
    [runId],
  );
  if (flipped.length === 0) return false;
  const run = flipped[0];
  await db.query(
    `update spend_ledger
        set reserved_usd = greatest(reserved_usd - $2::numeric, 0),
            actual_usd = actual_usd + $3::numeric,
            search_reserved = greatest(search_reserved - $4::int, 0),
            search_used = search_used + $5::int
      where day = $1::date`,
    [run.ledger_day, run.reserved_usd, a.actualUsd, run.reserved_searches, a.searchesUsed],
  );
  return true;
}

/** Records spend that was never reserved (chat replies are too small to reserve for). */
export async function addActualSpend(db: Db, usd: number, now = new Date()): Promise<void> {
  if (!(usd > 0)) return;
  await db.query(
    `insert into spend_ledger(day, actual_usd) values ($1::date, $2::numeric)
     on conflict (day) do update set actual_usd = spend_ledger.actual_usd + excluded.actual_usd`,
    [utcDay(now), usd],
  );
}
