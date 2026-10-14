import { after } from 'next/server';
import { cookies } from 'next/headers';
import { loadConfig } from '@/lib/config';
import { DEVICE_COOKIE, deviceCookieHeader, resolveIdentity } from '@/lib/identity';
import { buildMessageDeps } from '@/lib/server/deps';
import { handleMessage } from '@/lib/server/handleMessage';
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

/**
 * One visitor message. A research question answers with the run's event stream (SSE, as /api/run does);
 * anything else answers with JSON: { kind: 'chat' | 'decline', conversationId, reply }.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    let body: { message?: unknown; conversationId?: unknown } | null = null;
    try {
      body = await req.json();
    } catch {
      /* handled as an empty message below */
    }
    const message = typeof body?.message === 'string' ? body.message : '';
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

    const config = loadConfig();
    const db = await getDb();
    const jar = await cookies();
    const identity = resolveIdentity({ cookieValue: jar.get(DEVICE_COOKIE)?.value, headers: req.headers, salt: ipSalt() });

    const headers = new Headers();
    if (identity.isNewDevice) {
      headers.append('Set-Cookie', deviceCookieHeader(identity.deviceId, process.env.NODE_ENV === 'production'));
    }

    const result = await handleMessage({
      db, config, identity, message, conversationId, deps: buildMessageDeps({ config, db }),
    });
    if (!result.ok) {
      return Response.json({ error: result.code, message: result.message }, { status: result.status, headers });
    }
    if (result.kind === 'research') {
      after(result.done); // keep the function alive until the run is persisted, even if the client leaves
      headers.set('X-Run-Id', result.runId);
      headers.set('X-Conversation-Id', result.conversationId);
      return runEventStream(result.channel, headers);
    }
    headers.set('Cache-Control', 'no-store');
    return Response.json(
      { kind: result.kind, conversationId: result.conversationId, turnId: result.turnId, reply: result.reply },
      { headers },
    );
  } catch (e) {
    console.error('POST /api/chat failed', e);
    return Response.json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
