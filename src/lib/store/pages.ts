import type { Db } from './db';
import { cleanText } from './util';

export interface PageRecord {
  url: string;
  fetchStatus: 'ok' | 'failed';
  error?: string;
  contentType?: string;
  markdown?: string | null;
  bytes?: number;
}

export async function upsertPage(db: Db, runId: string, p: PageRecord): Promise<void> {
  await db.query(
    `insert into pages(run_id, url, fetch_status, error, content_type, markdown, bytes)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (run_id, url) do update set
       fetch_status = excluded.fetch_status, error = excluded.error, content_type = excluded.content_type,
       markdown = excluded.markdown, bytes = excluded.bytes`,
    [
      runId,
      cleanText(p.url),
      p.fetchStatus,
      p.error ? cleanText(p.error) : null,
      p.contentType ?? null,
      p.markdown ? cleanText(p.markdown) : null,
      p.bytes ?? null,
    ],
  );
}

export async function pruneOldPages(db: Db, olderThanDays: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  const rows = await db.query<{ n: number }>(
    `with d as (delete from pages where created_at < $1::timestamptz returning 1) select count(*)::int as n from d`,
    [cutoff],
  );
  return Number(rows[0].n);
}
