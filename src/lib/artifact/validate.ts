/**
 * The Content-Security-Policy stored inside every artifact. Together with the iframe sandbox it
 * is the real control: no network, no external resources, no nested frames, no form posts.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const DOC_START = /<!doctype html|<html[\s>]/i;

/** Pulls an HTML document out of model output: fenced block, or a bare document with prose around it. */
export function extractHtml(output: string): string | null {
  const text = output.trim();
  if (!text) return null;

  const fenced = /```(?:html)?[^\n]*\n([\s\S]*?)```/i.exec(text);
  let candidate = fenced ? fenced[1].trim() : text;

  const start = candidate.search(DOC_START);
  if (start < 0) return null;
  candidate = candidate.slice(start);

  if (!fenced) {
    const end = candidate.toLowerCase().lastIndexOf('</html>');
    if (end >= 0) candidate = candidate.slice(0, end + '</html>'.length);
  }
  return candidate.trim();
}

export type ArtifactCheck = { ok: true; html: string } | { ok: false; reason: string };

export function validateArtifact(output: string, maxChars: number): ArtifactCheck {
  const html = extractHtml(output);
  if (!html) return { ok: false, reason: 'The model did not return an HTML document' };
  if (!/<\/html>\s*$/i.test(html)) return { ok: false, reason: 'The HTML document was cut off before it ended' };
  if (html.length > maxChars) return { ok: false, reason: `The HTML document is too large (${html.length} characters)` };
  return { ok: true, html };
}

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

/**
 * Defence in depth around the sandbox: drop <base> and meta-refresh (navigation tricks) and
 * make the policy the first thing in <head>. Idempotent. No claim is made that stripping tags
 * with patterns is sufficient on its own; the policy and the sandbox are the controls.
 */
export function hardenArtifactHtml(html: string): string {
  if (html.includes(CSP_META)) return html;
  const out = html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '');
  if (/<head\b[^>]*>/i.test(out)) return out.replace(/<head\b[^>]*>/i, (m) => `${m}${CSP_META}`);
  if (/<html\b[^>]*>/i.test(out)) return out.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${CSP_META}</head>`);
  return `<head>${CSP_META}</head>${out}`;
}
