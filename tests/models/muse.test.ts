import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { streamMuse, type MuseEvent } from '@/lib/models/muse';
import { HttpError } from '@/lib/http/errors';
import { hang, sseResponse, testCtx } from '../helpers/http';

const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], ...extra })}\n\n`;
const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } })}\n\n`;
const DONE = 'data: [DONE]\n\n';

const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

async function collect(chunks: (string | Uint8Array)[]): Promise<{ events: MuseEvent[]; records: any[]; calls: any[] }> {
  const { ctx, records, calls } = testCtx(() => sseResponse(chunks));
  const events: MuseEvent[] = [];
  for await (const e of streamMuse(ctx, 'meta/muse', 'plan', req)) events.push(e);
  return { events, records, calls };
}

const toolStream = [
  chunk({ role: 'assistant', content: '' }),
  chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'score_queries', arguments: '' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"que' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: 'ries":["a","b"]}' } }] }),
  chunk({}, 'tool_calls'),
  usageChunk,
  DONE,
];

describe('streamMuse', () => {
  it('streams text deltas and finishes with usage and cost', async () => {
    const { events } = await collect([chunk({ content: 'Hel' }), chunk({ content: 'lo' }), chunk({}, 'stop'), usageChunk, DONE]);
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'finish', reason: 'stop', costUsd: 0.0001, inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it('surfaces a fragmented tool call only after the stream finishes, with parsed args', async () => {
    const { events } = await collect(toolStream);
    expect(events.map((e) => e.type)).toEqual(['tool_drafting', 'tool_call', 'finish']);
    const call = events[1] as Extract<MuseEvent, { type: 'tool_call' }>;
    expect(call.call).toMatchObject({ id: 'call_1', name: 'score_queries', args: { queries: ['a', 'b'] } });
  });

  it('turns truncated arguments into tool_call_invalid, never tool_call', async () => {
    const { events } = await collect([
      chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'submit_queries', arguments: '{"queries":["a"' } }] }),
      chunk({}, 'tool_calls'),
      DONE,
    ]);
    expect(events.map((e) => e.type)).toEqual(['tool_drafting', 'tool_call_invalid', 'finish']);
  });

  it('treats finish_reason "length" as truncation: complete-looking calls are still invalid', async () => {
    const { events } = await collect([
      chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'submit_queries', arguments: '{"queries":["a"]}' } }] }),
      chunk({}, 'length'),
      DONE,
    ]);
    expect(events.map((e) => e.type)).toEqual(['tool_drafting', 'tool_call_invalid', 'finish']);
  });

  it('rejects when the stream ends without a finish reason (nothing partial is trusted)', async () => {
    await expect(
      collect([chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{"a":' } }] }), DONE]),
    ).rejects.toThrow(/finish/i);
  });

  it('rejects on an upstream error chunk', async () => {
    await expect(collect([`data: ${JSON.stringify({ error: { message: 'rate limited' } })}\n\n`])).rejects.toThrow(/rate limited/);
  });

  it('ignores SSE comment lines such as OPENROUTER PROCESSING', async () => {
    const { events } = await collect([': OPENROUTER PROCESSING\n\n', chunk({ content: 'ok' }), chunk({}, 'stop'), DONE]);
    expect(events.map((e) => e.type)).toEqual(['text', 'finish']);
  });

  it('throws HttpError on a non-2xx response and records the call', async () => {
    const { ctx, records } = testCtx(() => new Response('{"error":"no"}', { status: 402 }));
    await expect(async () => {
      for await (const _ of streamMuse(ctx, 'm', 'plan', req)) void _;
    }).rejects.toBeInstanceOf(HttpError);
    expect(records[0].httpStatus).toBe(402);
  });

  it('sends a streaming request with tools and records it without the API key', async () => {
    const { ctx, calls, records } = testCtx(() => sseResponse(toolStream));
    const tools = [{ type: 'function' as const, function: { name: 'score_queries', description: 'd', parameters: {} } }];
    for await (const _ of streamMuse(ctx, 'meta/muse', 'plan', { ...req, tools, maxTokens: 500, reasoningEffort: 'low' })) void _;
    expect(calls[0].url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(calls[0].body).toMatchObject({ model: 'meta/muse', stream: true, max_tokens: 500, tools, reasoning: { effort: 'low' } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ stage: 'plan', model: 'meta/muse', httpStatus: 200, costUsd: 0.0001 });
    expect(JSON.stringify(records[0])).not.toContain('sk-test-secret');
  });

  it('produces identical events however the byte stream is split', async () => {
    const bytes = new TextEncoder().encode(toolStream.join(''));
    const baseline = (await collect(toolStream)).events;
    for (let i = 0; i <= bytes.length; i += 3) {
      const { events } = await collect([bytes.slice(0, i), bytes.slice(i)]);
      expect(events).toEqual(baseline);
    }
  });
});

const noSleep = async () => {};

describe('streamMuse retries and timeouts (final review)', () => {
  const okChunks = [chunk({ content: 'hi' }), chunk({}, 'stop'), DONE];
  async function run(handler: Parameters<typeof testCtx>[0], tweak: (ctx: any) => void = () => {}) {
    const t = testCtx(handler);
    t.ctx.retry = { retries: 2, baseMs: 1, sleep: noSleep };
    tweak(t.ctx);
    const events: MuseEvent[] = [];
    let error: unknown;
    try {
      for await (const e of streamMuse(t.ctx, 'm', 'plan', req)) events.push(e);
    } catch (e) {
      error = e;
    }
    return { events, error, calls: t.calls };
  }

  it('retries a 429 when opening the request and then streams normally', async () => {
    let n = 0;
    const { events, calls } = await run(() => (++n === 1 ? new Response('slow down', { status: 429 }) : sseResponse(okChunks)));
    expect(calls).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['text', 'finish']);
  });

  it('does not retry a 400', async () => {
    const { error, calls } = await run(() => new Response('bad', { status: 400 }));
    expect(error).toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after 2 retries on persistent 5xx', async () => {
    const { error, calls } = await run(() => new Response('down', { status: 503 }));
    expect(error).toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(3);
  });

  it('never retries once output has started (a mid-stream failure surfaces)', async () => {
    const { events, error, calls } = await run(() =>
      sseResponse([chunk({ content: 'partial' }), `data: ${JSON.stringify({ error: { message: 'boom' } })}\n\n`]),
    );
    expect(events.map((e) => e.type)).toEqual(['text']);
    expect(String(error)).toMatch(/boom/);
    expect(calls).toHaveLength(1);
  });

  it('times out waiting for response headers and retries that', async () => {
    let n = 0;
    const { events, calls } = await run(
      (url, init) => (++n === 1 ? (hang(url, init) as Promise<Response>) : sseResponse(okChunks)),
      (ctx) => { ctx.timeoutMs = 20; },
    );
    expect(calls).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('fails a stream that goes silent mid-way instead of waiting for the run limit', async () => {
    const stalled = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(chunk({ content: 'start' })));
          },
        }),
        { status: 200 },
      );
    const { error } = await run(stalled, (ctx) => { ctx.idleMs = 25; });
    expect(error).toMatchObject({ name: 'TimeoutError' });
  });

  it('keepalive comments keep a slow-thinking stream alive', async () => {
    const slow = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            const enc = new TextEncoder();
            for (let i = 0; i < 6; i++) {
              c.enqueue(enc.encode(': OPENROUTER PROCESSING\n\n'));
              await new Promise((r) => setTimeout(r, 15));
            }
            c.enqueue(enc.encode(okChunks.join('')));
            c.close();
          },
        }),
        { status: 200 },
      );
    const { events } = await run(slow, (ctx) => { ctx.idleMs = 40; });
    expect(events.at(-1)?.type).toBe('finish');
  });
});

const fixtureDir = path.join(__dirname, '../fixtures');
const toolFixture = path.join(fixtureDir, 'muse-tool-stream.sse');
const textFixture = path.join(fixtureDir, 'muse-text-stream.sse');

describe.skipIf(!fs.existsSync(toolFixture))('real captured Muse tool stream', () => {
  it('parses to complete tool calls identically at every split point', async () => {
    const bytes = new TextEncoder().encode(fs.readFileSync(toolFixture, 'utf8'));
    const baseline = (await collect([bytes])).events;
    const calls = baseline.filter((e) => e.type === 'tool_call');
    expect(calls.length).toBeGreaterThan(0);
    expect(baseline.at(-1)?.type).toBe('finish');
    for (let i = 0; i <= bytes.length; i += 7) {
      expect((await collect([bytes.slice(0, i), bytes.slice(i)])).events).toEqual(baseline);
    }
  });
});

describe.skipIf(!fs.existsSync(textFixture))('real captured Muse text stream', () => {
  it('parses to text deltas and a finish event', async () => {
    const { events } = await collect([fs.readFileSync(textFixture, 'utf8')]);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.at(-1)?.type).toBe('finish');
  });
});

describe('streamMuse request overrides (artifact stage)', () => {
  it('records the stage given on the request', async () => {
    const { ctx, records } = testCtx(() => sseResponse([chunk({ content: 'x' }), chunk({}, 'stop'), DONE]));
    for await (const _ of streamMuse(ctx, 'm', 'report', { ...req, stage: 'artifact' })) void _;
    expect(records[0].stage).toBe('artifact');
  });

  it('aborts when the request signal fires, even in the middle of a stream', async () => {
    const ac = new AbortController();
    const stalled = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(chunk({ content: 'start' })));
          },
        }),
        { status: 200 },
      );
    const { ctx } = testCtx(stalled);
    const seen: string[] = [];
    const running = (async () => {
      for await (const e of streamMuse(ctx, 'm', 'plan', { ...req, signal: ac.signal })) seen.push(e.type);
    })();
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual(['text']);
  });
});
