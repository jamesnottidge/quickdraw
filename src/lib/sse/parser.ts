export interface SseParser {
  /** Feed bytes (or text); returns the data payload of every frame completed by this chunk. */
  push(chunk: Uint8Array | string): string[];
  /** True while an incomplete frame is buffered. */
  pending(): boolean;
}

const FRAME_END = /\r?\n\r?\n/;

function dataOf(frame: string): string | null {
  const lines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      const v = line.slice(5);
      lines.push(v.startsWith(' ') ? v.slice(1) : v);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

export function createSseParser(): SseParser {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const out: string[] = [];
      for (;;) {
        const m = FRAME_END.exec(buffer);
        if (!m) break;
        const frame = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const data = dataOf(frame);
        if (data !== null) out.push(data);
      }
      return out;
    },
    pending: () => buffer.length > 0,
  };
}
