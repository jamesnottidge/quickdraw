import { getDb } from '@/lib/store';
import { pruneOldPages } from '@/lib/store/pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 90;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = await getDb();
  return Response.json({ pruned: await pruneOldPages(db, RETENTION_DAYS) });
}
