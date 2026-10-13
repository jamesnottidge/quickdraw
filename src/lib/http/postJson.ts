import type { ModelCtx, Stage } from '@/lib/models/types';
import { HttpError } from './errors';

export interface PostJsonOpts {
  ctx: ModelCtx;
  path: string;
  body: unknown;
  stage: Stage;
  model: string;
  usage: (json: unknown) => { inputTokens: number; outputTokens: number; costUsd: number };
}

export async function postJson<T>(o: PostJsonOpts): Promise<T> {
  const started = Date.now();
  let status = 0;
  let json: unknown = null;
  let text = '';
  try {
    const res = await o.ctx.fetchImpl(o.ctx.baseUrl + o.path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(o.body),
      signal: o.ctx.signal,
    });
    status = res.status;
    text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok) throw new HttpError(status, text);
    if (json === null) throw new Error('Upstream returned a non-JSON body');
    return json as T;
  } finally {
    const ok = status >= 200 && status < 300 && json !== null;
    const u = ok ? o.usage(json) : { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    try {
      await o.ctx.record({
        stage: o.stage,
        model: o.model,
        request: o.body,
        response: json ?? text,
        httpStatus: status,
        latencyMs: Date.now() - started,
        ...u,
      });
    } catch {
      /* recording must never fail the call */
    }
  }
}
