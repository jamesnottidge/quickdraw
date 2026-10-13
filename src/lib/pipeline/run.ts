import type { EventBody } from '@/lib/events/schema';
import { gather, type GatherDeps } from './gather';
import { planQueries, type PlanDeps } from './plan';
import { noSourcesReport, writeReport, type ReportDeps } from './report';

export interface PipelineDeps extends PlanDeps, GatherDeps, ReportDeps {
  tldr: (reportText: string) => Promise<{ text: string; costUsd: number }>;
  cost: { total(): number };
}

function failureMessage(e: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'The run hit its time limit before it could finish.';
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export async function* runPipeline(prompt: string, deps: PipelineDeps): AsyncGenerator<EventBody, void> {
  yield { type: 'run_started', prompt };
  try {
    const queries = yield* planQueries(prompt, deps);
    const summaries = yield* gather(prompt, queries, deps);

    if (summaries.length === 0) {
      yield { type: 'report_done', text: noSourcesReport(queries) };
    } else {
      const report = yield* writeReport(prompt, summaries, deps);
      try {
        const tldr = await deps.tldr(report);
        yield { type: 'tldr_done', text: tldr.text };
      } catch {
        /* the TLDR is optional; the report is already delivered */
      }
    }
    yield { type: 'run_finished', costUsd: deps.cost.total() };
  } catch (e) {
    yield { type: 'run_failed', message: failureMessage(e, deps.signal) };
  }
}
