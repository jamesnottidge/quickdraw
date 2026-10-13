import { cookies } from 'next/headers';
import { loadConfig } from '@/lib/config';
import { DEVICE_COOKIE, isDeviceId } from '@/lib/identity';
import { getRunList } from '@/lib/server/runList';
import { getDb } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const jar = await cookies();
    const raw = jar.get(DEVICE_COOKIE)?.value;
    const deviceId = raw && isDeviceId(raw) ? raw : undefined;
    const runs = await getRunList(await getDb(), loadConfig(), deviceId);
    return Response.json({ runs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/runs failed', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
