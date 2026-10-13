import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { streamMuse, type MuseEvent } from '@/lib/models/muse';
import { HttpError } from '@/lib/http/errors';
import { sseResponse, testCtx } from '../helpers/http';

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
