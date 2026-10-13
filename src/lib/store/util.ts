import { createHash } from 'node:crypto';

/** Postgres text and jsonb reject NUL; web content contains it. */
export function cleanText(s: string): string {
  return s.replaceAll('\u0000', '');
}

export function jsonParam(v: unknown): string {
  return JSON.stringify(v ?? null).replaceAll('\\u0000', '');
}

export const MAX_STORED_STRING = 8000;

/**
 * Replaces very large strings (fetched page text, base64 documents) with a short marker.
 * The full page text already lives in `pages`, so repeating it in every model call would multiply
 * storage. Returns a copy; the input is never mutated.
 */
export function compactForStorage(value: unknown, max = MAX_STORED_STRING): unknown {
  if (typeof value === 'string') {
    if (value.length <= max) return value;
    const sha = createHash('sha256').update(value).digest('hex').slice(0, 12);
    return `[redacted ${value.length} chars sha256:${sha} | ${value.slice(0, 60).replace(/\s+/g, ' ')}…]`;
  }
  if (Array.isArray(value)) return value.map((v) => compactForStorage(v, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compactForStorage(v, max)]));
  }
  return value;
}
