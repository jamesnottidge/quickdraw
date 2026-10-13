import { getDb } from '@/lib/store';
import { countReconnects } from '@/lib/store/reconnects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = await getDb();
  return Response.json({ reconnects: await countReconnects(db) });
}
