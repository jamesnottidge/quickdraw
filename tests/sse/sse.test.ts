import { describe, it, expect } from 'vitest';
import { encodeEvent, SSE_HEARTBEAT } from '@/lib/sse/encode';
import { createSseParser } from '@/lib/sse/parser';
import type { RunEvent } from '@/lib/events/schema';

const events: RunEvent[] = [
  { runId: 'r', seq: 1, ts: 1, type: 'run_started', prompt: 'héllo 🌍 世界\nsecond line "quoted"' },
  { runId: 'r', seq: 2, ts: 2, type: 'report_delta', text: 'data: not a frame\n\nstill the same event' },
  { runId: 'r', seq: 3, ts: 3, type: 'run_finished', costUsd: 0.0123 },
];

const wire = events.map(encodeEvent).join('');
const bytes = new TextEncoder().encode(wire);

function parseChunks(chunks: Uint8Array[]): unknown[] {
  const p = createSseParser();
  return chunks.flatMap((c) => p.push(c)).map((s) => JSON.parse(s));
}

describe('SSE parser', () => {
  it('survives every two-way split of the byte stream (including inside multi-byte characters)', () => {
    for (let i = 0; i <= bytes.length; i++) {
      expect(parseChunks([bytes.slice(0, i), bytes.slice(i)])).toEqual(events);
    }
  });

  it('survives byte-by-byte delivery', () => {
    const chunks = Array.from(bytes, (_, i) => bytes.slice(i, i + 1));
    expect(parseChunks(chunks)).toEqual(events);
  });

  it('ignores keepalive comments', () => {
    const p = createSseParser();
    const out = p.push(SSE_HEARTBEAT + encodeEvent(events[0]) + ': OPENROUTER PROCESSING\n\n');
    expect(out.map((s) => JSON.parse(s))).toEqual([events[0]]);
  });

  it('accepts CRLF framing and a terminator split across chunks', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\r\n\r')).toEqual([]);
    expect(p.push('\ndata: {"b":2}\r\n\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data fields with a newline', () => {
    const p = createSseParser();
    expect(p.push('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('never emits an unterminated frame and reports pending data', () => {
    const p = createSseParser();
    expect(p.push('data: {"half":')).toEqual([]);
    expect(p.pending()).toBe(true);
    expect(p.push('1}\n\n')).toEqual(['{"half":1}']);
    expect(p.pending()).toBe(false);
  });
});
