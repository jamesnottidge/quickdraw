import type { RunEvent } from '@/lib/events/schema';

// JSON.stringify never emits a raw newline, so one event is always one `data:` line.
export function encodeEvent(ev: RunEvent): string {
  return `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export const SSE_HEARTBEAT = ': keepalive\n\n';
