import { describe, it, expect } from 'vitest';
import { consumeEventStream } from '@/lib/sse/consume';
import { encodeEvent } from '@/lib/sse/encode';
import type { RunEvent } from '@/lib/events/schema';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

const e1: RunEvent = { runId: 'r', seq: 1, ts: 1, type: 'run_started', prompt: 'p' };
const e2: RunEvent = { runId: 'r', seq: 2, ts: 2, type: 'run_finished', costUsd: 0 };

describe('consumeEventStream', () => {
  it('delivers validated events and counts invalid frames without throwing', async () => {
    const got: RunEvent[] = [];
    const wire = encodeEvent(e1) + 'data: {not json}\n\n' + 'data: {"runId":"r","seq":9,"ts":1,"type":"nope"}\n\n' + encodeEvent(e2);
    const { invalidFrames } = await consumeEventStream(streamOf([wire.slice(0, 40), wire.slice(40)]), (e) => got.push(e));
    expect(got).toEqual([e1, e2]);
    expect(invalidFrames).toBe(2);
  });

  it('resolves normally when the stream ends mid-frame (caller decides what that means)', async () => {
    const got: RunEvent[] = [];
    await consumeEventStream(streamOf([encodeEvent(e1), 'data: {"runId":"r","se']), (e) => got.push(e));
    expect(got).toEqual([e1]);
  });
});
