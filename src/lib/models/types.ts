export type Stage = 'plan' | 'score_query' | 'judge_relevance' | 'summarize' | 'report' | 'tldr';

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
  /** e.g. https://openrouter.ai/api ; clients append /v1/chat/completions or /alpha/decisions */
  baseUrl: string;
}
