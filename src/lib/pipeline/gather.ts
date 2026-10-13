import type { AppConfig } from '@/lib/config';
import type { EventBody } from '@/lib/events/schema';
import type { FetchedPage } from '@/lib/fetch/fetchPage';
import { withRetry } from '@/lib/http/retry';
import type { RelevanceResult } from '@/lib/models/decisions';
import type { SummarizeInput } from '@/lib/models/scaledown-chat';
import { summarizeInstruction } from '@/lib/prompts';
import type { SearchBackend, SearchResult } from '@/lib/search/types';
import { normalizeUrl } from '@/lib/search/normalizeUrl';
import { streamTasks } from '@/lib/async/streamTasks';
import type { PageRecord } from '@/lib/store/pages';

export interface GatherDeps {
  config: AppConfig;
  search: SearchBackend;
  fetchPage: (url: string) => Promise<FetchedPage>;
  judgeRelevance: (question: string, text: string) => Promise<RelevanceResult>;
  summarize: (input: SummarizeInput) => Promise<{ text: string; costUsd: number }>;
  recordPage: (p: PageRecord) => Promise<void>;
  signal?: AbortSignal;
  /** Only for tests: replaces the real backoff sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GatheredSummary {
  url: string;
  title: string;
  summary: string;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function* gather(
  question: string,
  queries: string[],
  deps: GatherDeps,
): AsyncGenerator<EventBody, GatheredSummary[]> {
  const { config } = deps;
  const retry = { retries: config.retry.retries, baseMs: config.retry.baseMs, sleep: deps.sleep };

  // 1. Search every query in parallel.
  const byQuery = new Map<string, SearchResult[]>();
  yield* streamTasks<EventBody>(
    queries.map((q) => async (emit) => {
      emit({ type: 'search_started', query: q });
      let results: SearchResult[] = [];
      try {
        results = await withRetry(
          () => deps.search.search(q, { maxResults: config.search.maxResultsPerQuery, signal: deps.signal }),
          retry,
        );
      } catch {
        results = [];
      }
      byQuery.set(q, results);
      emit({ type: 'search_results', query: q, results: results.map((x) => ({ url: x.url, title: x.title })) });
    }),
    Math.max(1, queries.length),
  );

  // 2. Interleave results by rank so every query contributes, dedupe, cap.
  const picked: SearchResult[] = [];
  const seen = new Set<string>();
  const maxRank = Math.max(0, ...queries.map((q) => byQuery.get(q)?.length ?? 0));
  outer: for (let rank = 0; rank < maxRank; rank++) {
    for (const q of queries) {
      const result = byQuery.get(q)?.[rank];
      if (!result) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(result);
      if (picked.length >= config.limits.maxPages) break outer;
    }
  }

  // 3. Fetch, triage and summarize each page, streaming events as they happen.
  const summaries: (GatheredSummary & { rank: number })[] = [];
  const instruction = summarizeInstruction(question);

  yield* streamTasks<EventBody>(
    picked.map((result, rank) => async (emit) => {
      if (deps.signal?.aborted) return;
      let page: FetchedPage;
      try {
        page = await deps.fetchPage(result.url);
      } catch (e) {
        const reason = errMsg(e);
        emit({ type: 'page_failed', url: result.url, reason });
        await deps.recordPage({ url: result.url, fetchStatus: 'failed', error: reason }).catch(() => {});
        return;
      }

      const title = (page.kind === 'markdown' ? page.title : '') || result.title || result.url;
      emit({
        type: 'page_fetched',
        url: result.url,
        title,
        chars: page.kind === 'markdown' ? page.markdown.length : page.bytes,
        contentType: page.contentType,
      });
      await deps
        .recordPage({
          url: result.url,
          fetchStatus: 'ok',
          contentType: page.contentType,
          markdown: page.kind === 'markdown' ? page.markdown : null,
          bytes: page.bytes,
        })
        .catch(() => {});

      if (page.kind === 'markdown' && !page.markdown.trim()) {
        emit({ type: 'page_failed', url: result.url, reason: 'No readable text on this page' });
        return;
      }

      try {
        // Binary documents are summarized first so relevance is judged on text.
        let text: string;
        let summary: string | null = null;
        if (page.kind === 'markdown') {
          text = page.markdown;
        } else {
          summary = (
            await withRetry(
              () =>
                deps.summarize({
                  instruction,
                  binary: { mime: page.mime, dataUrl: page.dataUrl, filename: page.filename },
                }),
              retry,
            )
          ).text;
          text = summary;
        }
        const judged = await withRetry(() => deps.judgeRelevance(question, text), retry);
        emit({ type: 'page_judged', url: result.url, relevance: judged.relevance, relevant: judged.relevant });
        if (!judged.relevant) return;
        if (summary === null) {
          summary = (await withRetry(() => deps.summarize({ instruction, text }), retry)).text;
        }
        emit({ type: 'summary_done', url: result.url, title, summary });
        summaries.push({ url: result.url, title, summary, rank });
      } catch (e) {
        // The provider's error body is for logs, not for a visitor reading the trace.
        console.warn(`[gather] could not process ${result.url}: ${errMsg(e)}`);
        emit({ type: 'page_failed', url: result.url, reason: 'Could not analyse this page' });
      }
    }),
    config.fetch.concurrency,
  );

  return summaries.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...s }) => s);
}
