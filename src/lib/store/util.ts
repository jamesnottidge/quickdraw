/** Postgres text and jsonb reject NUL; web content contains it. */
export function cleanText(s: string): string {
  return s.replaceAll('\u0000', '');
}

export function jsonParam(v: unknown): string {
  return JSON.stringify(v ?? null).replaceAll('\\u0000', '');
}
