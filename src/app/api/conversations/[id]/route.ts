import { cookies } from 'next/headers';
import { DEVICE_COOKIE, isDeviceId } from '@/lib/identity';
import { getDb } from '@/lib/store';
import { getConversationForDevice, listTurns } from '@/lib/store/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const raw = (await cookies()).get(DEVICE_COOKIE)?.value;
    const db = await getDb();
    const conversation = raw && isDeviceId(raw) ? await getConversationForDevice(db, id, raw) : null;
    if (!conversation) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ conversation, turns: await listTurns(db, id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/conversations/[id] failed', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
