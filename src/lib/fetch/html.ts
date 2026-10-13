import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe']);

function clean(md: string): string {
  return md.replaceAll('\u0000', '').replace(/\n{3,}/g, '\n\n').trim();
}

export function htmlToMarkdown(html: string): { title: string; markdown: string } {
  const safeHtml = html.replaceAll('\u0000', '');
  const { document } = parseHTML(safeHtml);
  const fallbackTitle = (document.title ?? '').trim();
  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    article = null;
  }
  let contentHtml = article?.content ?? '';
  if (!contentHtml) {
    // Readability mutates its document; parse a fresh copy for the fallback.
    contentHtml = parseHTML(safeHtml).document.body?.innerHTML ?? '';
  }
  return {
    title: (article?.title || fallbackTitle || '').trim(),
    markdown: clean(turndown.turndown(contentHtml)),
  };
}
