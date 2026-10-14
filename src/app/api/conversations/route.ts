import { cookies } from 'next/headers';
import { loadConfig } from '@/lib/config';
import { DEVICE_COOKIE, isDeviceId } from '@/lib/identity';
import { getConversationList } from '@/lib/server/conversationList';
import { getDb } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const raw = (await cookies()).get(DEVICE_COOKIE)?.value;
    const deviceId = raw && isDeviceId(raw) ? raw : undefined;
    const conversations = await getConversationList(await getDb(), loadConfig(), deviceId);
    return Response.json({ conversations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/conversations failed', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
