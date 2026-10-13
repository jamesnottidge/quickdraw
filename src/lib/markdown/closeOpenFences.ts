const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function closeOpenFences(md: string): string {
  let open: { char: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const m = FENCE.exec(line);
    if (!m) continue;
    const marker = m[1];
    if (!open) {
      open = { char: marker[0], len: marker.length };
    } else if (marker[0] === open.char && marker.length >= open.len && m[2].trim() === '') {
      open = null;
    }
  }
  if (!open) return md;
  return md + (md.endsWith('\n') ? '' : '\n') + open.char.repeat(open.len);
}
