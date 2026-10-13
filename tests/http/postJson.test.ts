import { describe, it, expect } from 'vitest';
import { postJson } from '@/lib/http/postJson';
import { HttpError } from '@/lib/http/errors';
import { jsonResponse, testCtx } from '../helpers/http';

const usage = (j: any) => ({
  inputTokens: j?.usage?.in ?? 0,
  outputTokens: j?.usage?.out ?? 0,
  costUsd: j?.usage?.cost ?? 0,
});

describe('postJson', () => {
  it('posts JSON with a bearer key, returns the body and records usage without the key', async () => {
    const { ctx, calls, records } = testCtx(() => jsonResponse({ ok: true, usage: { in: 3, out: 2, cost: 0.001 } }));
    const out = await postJson<{ ok: boolean }>({
      ctx, path: '/x', body: { a: 1 }, stage: 'summarize', model: 'm', usage,
    });
    expect(out.ok).toBe(true);
    expect(calls[0].url).toBe('https://openrouter.test/api/x');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-secret');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ stage: 'summarize', model: 'm', httpStatus: 200, inputTokens: 3, outputTokens: 2, costUsd: 0.001 });
    expect(JSON.stringify(records[0])).not.toContain('sk-test-secret');
  });

  it('throws HttpError on non-2xx but still records the failed call', async () => {
    const { ctx, records } = testCtx(() => jsonResponse({ error: { message: 'nope' } }, 400));
    await expect(
      postJson({ ctx, path: '/x', body: {}, stage: 'tldr', model: 'm', usage }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(records[0].httpStatus).toBe(400);
    expect(records[0].costUsd).toBe(0);
  });

  it('does not let a failing recorder break the call', async () => {
    const { ctx } = testCtx(() => jsonResponse({ ok: true }));
    ctx.record = () => { throw new Error('db down'); };
    await expect(postJson({ ctx, path: '/x', body: {}, stage: 'tldr', model: 'm', usage })).resolves.toEqual({ ok: true });
  });

  it('rejects a 200 with a non-JSON body', async () => {
    const { ctx } = testCtx(() => new Response('<html>', { status: 200 }));
    await expect(postJson({ ctx, path: '/x', body: {}, stage: 'tldr', model: 'm', usage })).rejects.toThrow(/non-JSON/);
  });
});
