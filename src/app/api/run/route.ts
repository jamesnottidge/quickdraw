import { after } from 'next/server';
import { cookies } from 'next/headers';
import { loadConfig } from '@/lib/config';
import { DEVICE_COOKIE, deviceCookieHeader, resolveIdentity } from '@/lib/identity';
import { buildPipelineDeps } from '@/lib/server/deps';
import { startRun } from '@/lib/server/startRun';
import { runEventStream } from '@/lib/server/sseResponse';
import { getDb } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function ipSalt(): string {
  const salt = process.env.IP_HASH_SALT;
  if (salt) return salt;
  if (process.env.FAKE_MODELS === '1') return 'dev-salt';
  throw new Error('Server is missing IP_HASH_SALT');
}

export async function POST(req: Request): Promise<Response> {
  try {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      /* handled as an empty prompt below */
    }
    const prompt = typeof (body as { prompt?: unknown } | null)?.prompt === 'string' ? (body as { prompt: string }).prompt : '';

    const config = loadConfig();
    const db = await getDb();
    const jar = await cookies();
    const identity = resolveIdentity({
      cookieValue: jar.get(DEVICE_COOKIE)?.value,
      headers: req.headers,
      salt: ipSalt(),
    });

    const headers = new Headers();
    if (identity.isNewDevice) {
      headers.append('Set-Cookie', deviceCookieHeader(identity.deviceId, process.env.NODE_ENV === 'production'));
    }

    const started = await startRun({
      db,
      config,
      identity,
      prompt,
      buildDeps: ({ runId, signal, meter }) => buildPipelineDeps({ config, runId, db, signal, meter }),
    });
    if (!started.ok) {
      return Response.json({ error: started.code, message: started.message }, { status: started.status, headers });
    }

    after(started.done); // keep the function alive until the run is persisted, even if the client leaves

    headers.set('X-Run-Id', started.runId);
    headers.set('X-Conversation-Id', started.conversationId);
    return runEventStream(started.channel, headers);
  } catch (e) {
    console.error('POST /api/run failed', e);
    return Response.json({ error: 'server_error', message: 'Something went wrong starting the run.' }, { status: 500 });
  }
}
