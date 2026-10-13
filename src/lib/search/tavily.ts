import { HttpError } from '@/lib/http/errors';
import type { SearchBackend, SearchResult } from './types';

interface TavilyOpts {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export function createTavilySearch(opts: TavilyOpts): SearchBackend {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.tavily.com';
  return {
    name: 'tavily',
    async search(query, { maxResults, signal }): Promise<SearchResult[]> {
      const res = await fetchImpl(`${baseUrl}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text);
      const json = JSON.parse(text) as { results?: { title?: string; url?: string; content?: string }[] };
      return (json.results ?? [])
        .filter((r): r is { title?: string; url: string; content?: string } => typeof r.url === 'string' && r.url !== '')
        .map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.content ?? '' }));
    },
  };
}
