import { parseRunEvent, type RunEvent } from '@/lib/events/schema';
import { createSseParser } from './parser';

export async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: RunEvent) => void,
): Promise<{ invalidFrames: number }> {
  const parser = createSseParser();
  const reader = body.getReader();
  let invalidFrames = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const payload of parser.push(value)) {
      try {
        onEvent(parseRunEvent(JSON.parse(payload)));
      } catch {
        invalidFrames++;
      }
    }
  }
  return { invalidFrames };
}
