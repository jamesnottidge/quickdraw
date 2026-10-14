import type { Channel } from '@/lib/async/channel';
import type { RunEvent } from '@/lib/events/schema';
import { SSE_HEARTBEAT, encodeEvent } from '@/lib/sse/encode';

/** Streams a run's events to the client. If the client leaves, the run carries on in the background. */
export function runEventStream(channel: Channel<RunEvent>, headers: Headers): Response {
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('X-Accel-Buffering', 'no');

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(SSE_HEARTBEAT));
        } catch {
          /* stream already closed */
        }
      }, 15_000);
      try {
        for await (const ev of channel) {
          if (cancelled) break;
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        }
      } catch {
        /* the client went away; the run continues in the background */
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      cancelled = true;
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers });
}
