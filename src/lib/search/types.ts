export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchBackend {
  name: string;
  search(query: string, opts: { maxResults: number; signal?: AbortSignal }): Promise<SearchResult[]>;
}
