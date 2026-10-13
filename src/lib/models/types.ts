import type { RetryOpts } from '@/lib/http/retry';

export type Stage = 'plan' | 'score_query' | 'judge_relevance' | 'summarize' | 'report' | 'tldr' | 'artifact';

export interface ModelCallRecord {
  stage: Stage;
  model: string;
  request: unknown;
  response: unknown;
  httpStatus: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelCtx {
  apiKey: string;
  fetchImpl: typeof fetch;
  record: (r: ModelCallRecord) => void | Promise<void>;
  signal?: AbortSignal;
  /** Per-call limit for non-streaming calls and for waiting on response headers. */
  timeoutMs?: number;
  /** Max silence on a streaming response. */
  idleMs?: number;
  /** Retry policy for opening a streaming request (Muse). */
  retry?: RetryOpts;
  /** e.g. https://openrouter.ai/api ; clients append /v1/chat/completions or /alpha/decisions */
  baseUrl: string;
}
