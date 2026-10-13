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
const PREFIX = `<!doctype html>${CSP_META}`;

/**
 * Makes the policy the literal first thing in the document. The HTML parser processes it before any
 * model-written byte, so no comment, string, duplicate <head>, or copy of the policy text in the content
 * can hide or replace it; the document's own doctype is then ignored, and standards mode comes from ours.
 * <base> and every http-equiv meta (meta refresh, including entity-obfuscated forms; the attribute name
 * cannot be obfuscated) are removed as defence in depth. The policy, the iframe sandbox and the host's
 * frame-src are the controls; tag stripping is not claimed to be sufficient. Idempotent.
 */
export function hardenArtifactHtml(html: string): string {
  if (html.startsWith(PREFIX)) return html;
  const cleaned = html.replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '');
  return PREFIX + cleaned;
}
