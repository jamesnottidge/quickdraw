import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe']);

function clean(md: string): string {
  return md.replaceAll('\u0000', '').replace(/\n{3,}/g, '\n\n').trim();
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `textChars` is the readable text length: markdown also counts every link URL, which inflates it. */
export function htmlToMarkdown(html: string): { title: string; markdown: string; textChars: number } {
  const safeHtml = html.replaceAll('\u0000', '');
  const { document } = parseHTML(safeHtml);
  const fallbackTitle = (document.title ?? '').trim();
  let article: { title?: string | null; content?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    article = null;
  }
  let contentHtml = article?.content ?? '';
  let readable = article?.textContent ?? '';
  if (!contentHtml) {
    // Readability mutates its document; parse a fresh copy for the fallback.
    const fresh = parseHTML(safeHtml).document;
    contentHtml = fresh.body?.innerHTML ?? '';
    readable = fresh.body?.textContent ?? '';
  }
  return {
    title: (article?.title || fallbackTitle || '').trim(),
    markdown: clean(turndown.turndown(contentHtml)),
    textChars: collapse(readable.replaceAll('\u0000', '')).length,
  };
}
