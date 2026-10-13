import { describe, it, expect } from 'vitest';
import { createTavilySearch } from '@/lib/search/tavily';
import { HttpError } from '@/lib/http/errors';
import { jsonResponse, makeFetch } from '../helpers/http';

describe('createTavilySearch', () => {
  it('posts a basic search with a bearer key and maps results', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({
        results: [
          { title: 'A', url: 'https://a.test/1', content: 'snippet a', score: 0.9 },
          { title: 'no url', content: 'x' },
          { title: 'B', url: 'https://b.test/2', content: 'snippet b' },
        ],
      }),
    );
    const s = createTavilySearch({ apiKey: 'tvly-secret', fetchImpl });
    const out = await s.search('legal rag chunking', { maxResults: 5 });
    expect(out).toEqual([
      { title: 'A', url: 'https://a.test/1', snippet: 'snippet a' },
      { title: 'B', url: 'https://b.test/2', snippet: 'snippet b' },
    ]);
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-secret');
    expect(calls[0].body).toMatchObject({
      query: 'legal rag chunking',
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    });
  });

  it('throws HttpError on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ detail: 'bad key' }, 401));
    await expect(createTavilySearch({ apiKey: 'k', fetchImpl }).search('q', { maxResults: 3 })).rejects.toBeInstanceOf(HttpError);
  });

  it('returns an empty list when results is missing', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    expect(await createTavilySearch({ apiKey: 'k', fetchImpl }).search('q', { maxResults: 3 })).toEqual([]);
  });
});
