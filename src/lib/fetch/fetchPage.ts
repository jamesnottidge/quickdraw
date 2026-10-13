import type { AppConfig } from '@/lib/config';
import { FetchError } from './errors';
import { htmlToMarkdown } from './html';
import { assertSafeUrl } from './ssrf';

export type FetchedPage =
  | {
      kind: 'markdown';
      url: string;
      finalUrl: string;
      title: string;
      markdown: string;
      contentType: string;
      bytes: number;
      truncated: boolean;
    }
  | {
      kind: 'binary';
      url: string;
      finalUrl: string;
      mime: string;
      contentType: string;
      dataUrl: string;
      filename: string;
      bytes: number;
    };

export interface FetchPageDeps {
  fetchImpl: typeof fetch;
  limits: AppConfig['fetch'];
  maxChars: number;
  signal?: AbortSignal;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; CDMResearchBot/0.1; +research-experiment)';
const ACCEPT = 'text/html,application/xhtml+xml,application/pdf;q=0.9,image/*;q=0.8,text/plain;q=0.7,*/*;q=0.1';

async function readCapped(res: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (total + value.length > max) {
      const keep = max - total;
      if (keep > 0) {
        chunks.push(value.slice(0, keep));
        total += keep;
      }
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, truncated };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function filenameFor(url: string, mime: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  return mime === 'application/pdf' ? 'document.pdf' : `file.${mime.split('/')[1] ?? 'bin'}`;
}

export async function fetchPage(url: string, deps: FetchPageDeps): Promise<FetchedPage> {
  const { limits } = deps;
  const timeout = AbortSignal.timeout(limits.timeoutMs);
  const signal = deps.signal ? AbortSignal.any([timeout, deps.signal]) : timeout;

  let current = url;
  let res: Response | null = null;
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const safe = assertSafeUrl(current);
    const r = await deps.fetchImpl(safe.toString(), {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: ACCEPT },
      signal,
    });
    const location = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && location) {
      await r.body?.cancel().catch(() => {});
      if (hop === limits.maxRedirects) throw new FetchError('Too many redirects');
      current = new URL(location, safe).toString();
      continue;
    }
    res = r;
    break;
  }
  if (!res) throw new FetchError('Too many redirects');
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new FetchError(`HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const mime = contentType.split(';')[0].trim().toLowerCase();

  if (mime === 'application/pdf' || mime.startsWith('image/')) {
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > limits.maxBinaryBytes) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError('File too large');
    }
    const { bytes, truncated } = await readCapped(res, limits.maxBinaryBytes);
    if (truncated) throw new FetchError('File too large');
    return {
      kind: 'binary',
      url,
      finalUrl: current,
      mime,
      contentType: mime,
      dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      filename: filenameFor(current, mime),
      bytes: bytes.length,
    };
  }

  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml';
  if (!isHtml && mime !== 'text/plain') {
    await res.body?.cancel().catch(() => {});
    throw new FetchError(`Unsupported content-type: ${mime || 'unknown'}`);
  }

  const { bytes, truncated } = await readCapped(res, limits.maxBytes);
  const text = decode(bytes, contentType);
  const { title, markdown, textChars } = isHtml
    ? htmlToMarkdown(text)
    : { title: '', markdown: text.replaceAll('\u0000', '').trim(), textChars: text.trim().length };
  // Judge usefulness by readable text; markdown length also counts every link URL.
  if (textChars < limits.minChars) throw new FetchError('Page has too little content to use');
  return {
    kind: 'markdown',
    url,
    finalUrl: current,
    title,
    markdown: markdown.slice(0, deps.maxChars),
    contentType: mime,
    bytes: bytes.length,
    truncated,
  };
}
