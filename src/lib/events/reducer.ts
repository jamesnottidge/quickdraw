import type { RunEvent } from './schema';

export interface PageView {
  url: string;
  title?: string;
  status: 'fetched' | 'failed' | 'judged' | 'summarized';
  reason?: string;
  relevance?: number;
  relevant?: boolean;
  summary?: string;
}

export interface RoundView {
  round: number;
  drafting: boolean;
  queries: string[];
  scores: Record<string, { score: number; band: string; confidence: number }>;
}

export interface SourceView {
  n: number;
  url: string;
  title: string;
  snippet: string;
}

export interface ArtifactView {
  status: 'idle' | 'building' | 'ready' | 'failed';
  html?: string;
  reason?: string;
}

export interface RunView {
  status: 'idle' | 'running' | 'finished' | 'failed' | 'interrupted';
  lastSeq: number;
  prompt: string;
  rounds: RoundView[];
  capHit: boolean;
  submitted: string[];
  searches: Record<string, { url: string; title: string }[] | null>;
  pages: Record<string, PageView>;
  pageOrder: string[];
  report: string;
  reportDone: boolean;
  tldr: string | null;
  costUsd: number | null;
  error: string | null;
  sources: SourceView[];
  artifact: ArtifactView;
}

export const initialRunView: RunView = {
  status: 'idle',
  lastSeq: 0,
  prompt: '',
  rounds: [],
  capHit: false,
  submitted: [],
  searches: {},
  pages: {},
  pageOrder: [],
  report: '',
  reportDone: false,
  tldr: null,
  costUsd: null,
  error: null,
  sources: [],
  artifact: { status: 'idle' },
};

function upsertRound(rounds: RoundView[], round: number, fn: (r: RoundView) => RoundView): RoundView[] {
  const existing = rounds.find((r) => r.round === round) ?? {
    round,
    drafting: false,
    queries: [],
    scores: {},
  };
  const updated = fn(existing);
  const others = rounds.filter((r) => r.round !== round);
  return [...others, updated].sort((a, b) => a.round - b.round);
}

function upsertPage(state: RunView, url: string, patch: Partial<PageView>): Pick<RunView, 'pages' | 'pageOrder'> {
  const prev = state.pages[url];
  const next: PageView = { ...(prev ?? { url, status: 'fetched' as const }), ...patch };
  return {
    pages: { ...state.pages, [url]: next },
    pageOrder: prev ? state.pageOrder : [...state.pageOrder, url],
  };
}

export function applyEvent(state: RunView, ev: RunEvent): RunView {
  if (state.status === 'interrupted' || state.status === 'finished' || state.status === 'failed') return state;
  if (ev.seq <= state.lastSeq) return state;
  if (ev.seq !== state.lastSeq + 1) {
    return {
      ...state,
      status: 'interrupted',
      error: `Missing events: expected #${state.lastSeq + 1}, received #${ev.seq}`,
    };
  }
  const base: RunView = { ...state, lastSeq: ev.seq };
  switch (ev.type) {
    case 'run_started':
      return { ...base, status: 'running', prompt: ev.prompt };
    case 'queries_drafting':
      return { ...base, rounds: upsertRound(base.rounds, ev.round, (r) => ({ ...r, drafting: true })) };
    case 'queries_drafted':
      return {
        ...base,
        rounds: upsertRound(base.rounds, ev.round, (r) => ({ ...r, drafting: false, queries: ev.queries })),
      };
    case 'query_scored':
      return {
        ...base,
        rounds: upsertRound(base.rounds, ev.round, (r) => ({
          ...r,
          scores: { ...r.scores, [ev.query]: { score: ev.score, band: ev.band, confidence: ev.confidence } },
        })),
      };
    case 'plan_cap_hit':
      return { ...base, capHit: true };
    case 'queries_submitted':
      return { ...base, submitted: ev.queries };
    case 'search_started':
      return { ...base, searches: { ...base.searches, [ev.query]: null } };
    case 'search_results':
      return { ...base, searches: { ...base.searches, [ev.query]: ev.results } };
    case 'page_fetched':
      return { ...base, ...upsertPage(base, ev.url, { title: ev.title, status: 'fetched' }) };
    case 'page_failed':
      return { ...base, ...upsertPage(base, ev.url, { status: 'failed', reason: ev.reason }) };
    case 'page_judged':
      return {
        ...base,
        ...upsertPage(base, ev.url, { status: 'judged', relevance: ev.relevance, relevant: ev.relevant }),
      };
    case 'summary_done':
      return { ...base, ...upsertPage(base, ev.url, { status: 'summarized', title: ev.title, summary: ev.summary }) };
    case 'report_delta':
      return { ...base, report: base.report + ev.text };
    case 'report_done':
      return { ...base, report: ev.text, reportDone: true };
    case 'tldr_done':
      return { ...base, tldr: ev.text };
    case 'sources_ready':
      return { ...base, sources: ev.sources };
    case 'artifact_started':
      return { ...base, artifact: { status: 'building' } };
    case 'artifact_done':
      return { ...base, artifact: { status: 'ready', html: ev.html } };
    case 'artifact_failed':
      return { ...base, artifact: { status: 'failed', reason: ev.reason } };
    case 'run_finished':
      return { ...base, status: 'finished', costUsd: ev.costUsd };
    case 'run_failed':
      return { ...base, status: 'failed', error: ev.message };
    default: {
      const _exhaustive: never = ev;
      return _exhaustive;
    }
  }
}

export function markStreamEnded(state: RunView): RunView {
  if (state.status !== 'running') return state;
  return { ...state, status: 'interrupted', error: 'The connection ended before the run finished.' };
}
