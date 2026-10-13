import type { ModelCallRecord, ModelCtx } from '@/lib/models/types';

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: any;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A streaming Response that delivers each chunk as a separate read. */
export function sseResponse(chunks: (string | Uint8Array)[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch);
      c.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

export function makeFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: any = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as string */
      }
    }
    calls.push({ url, init: init ?? {}, body });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function testCtx(handler: Handler) {
  const { fetchImpl, calls } = makeFetch(handler);
  const records: ModelCallRecord[] = [];
  const ctx: ModelCtx = {
    apiKey: 'sk-test-secret',
    fetchImpl,
    record: (r) => {
      records.push(r);
    },
    baseUrl: 'https://openrouter.test/api',
  };
  return { ctx, calls, records };
}

/** A fetch that never answers until its signal aborts, then rejects with the signal's reason (like undici). */
export const hang = (_url: string, init: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  });
