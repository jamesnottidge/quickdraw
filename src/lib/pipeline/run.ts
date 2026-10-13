import type { EventBody } from '@/lib/events/schema';
import { buildArtifact } from './artifact';
import { gather, type GatherDeps } from './gather';
import { planQueries, type PlanDeps } from './plan';
import { noSourcesReport, writeReport, type ReportDeps } from './report';

export interface PipelineDeps extends PlanDeps, GatherDeps, ReportDeps {
  tldr: (reportText: string) => Promise<{ text: string; costUsd: number }>;
  cost: { total(): number };
  /** Only for tests: replaces the wall clock used by the artifact time box. */
  now?: () => number;
}

function failureMessage(e: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'The run hit its time limit before it could finish.';
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export async function* runPipeline(prompt: string, deps: PipelineDeps): AsyncGenerator<EventBody, void> {
  yield { type: 'run_started', prompt };
  const startedAt = (deps.now ?? Date.now)();
  try {
    const queries = yield* planQueries(prompt, deps);
    const summaries = yield* gather(prompt, queries, deps);

    if (summaries.length === 0) {
      yield { type: 'report_done', text: noSourcesReport(queries) };
    } else {
      const sources = summaries.map((s, i) => ({ n: i + 1, url: s.url, title: s.title, snippet: s.summary.slice(0, 280) }));
      yield { type: 'sources_ready', sources };
      const report = yield* writeReport(prompt, summaries, deps);
      try {
        const tldr = await deps.tldr(report);
        yield { type: 'tldr_done', text: tldr.text };
      } catch {
        /* the TLDR is optional; the report is already delivered */
      }
      // Time-boxed and failure-tolerant: this never throws, so it cannot turn a good run into run_failed.
      yield* buildArtifact(report, sources, startedAt, deps);
    }
    yield { type: 'run_finished', costUsd: deps.cost.total() };
  } catch (e) {
    yield { type: 'run_failed', message: failureMessage(e, deps.signal) };
  }
}
