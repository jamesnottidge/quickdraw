import { cookies } from 'next/headers';
import { DEVICE_COOKIE, resolveIdentity } from '@/lib/identity';
import { getDb } from '@/lib/store';
import { insertReconnect } from '@/lib/store/reconnects';
import { loadConfig } from '@/lib/config';
import { getReplay } from '@/lib/server/replay';
import { upsertSession } from '@/lib/store/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const db = await getDb();
    const replay = await getReplay(db, loadConfig(), id);
    if (!replay) return Response.json({ error: 'not_found' }, { status: 404 });
    const { run, events, active } = replay;

    // A background poll (?poll=1) is not a reconnect; the first open of an in-progress run is.
    if (active && !new URL(req.url).searchParams.has('poll')) {
      const jar = await cookies();
      const identity = resolveIdentity({
        cookieValue: jar.get(DEVICE_COOKIE)?.value,
        headers: req.headers,
        salt: process.env.IP_HASH_SALT ?? 'dev-salt',
      });
      const sessionId = await upsertSession(db, identity).catch(() => null);
      await insertReconnect(db, { runId: id, sessionId, runActive: true }).catch((e) =>
        console.error('reconnect log failed', e),
      );
    }

    return Response.json(
      { run, events, active },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('GET /api/run/[id] failed', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
