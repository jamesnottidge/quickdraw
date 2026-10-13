import { describe, it, expect } from 'vitest';
import { runPipeline } from '@/lib/pipeline/run';
import { createFakeDeps } from '@/lib/pipeline/fakes';
import { drain } from '../helpers/gen';

const types = (events: { type: string }[]) => events.map((e) => e.type);
const terminals = (events: { type: string }[]) => events.filter((e) => e.type === 'run_finished' || e.type === 'run_failed');

describe('runPipeline', () => {
  it('runs plan, gather, report and tldr end to end and ends with exactly one run_finished', async () => {
    const { events } = await drain(runPipeline('legal rag chunking', createFakeDeps()));
    const t = types(events);
    expect(t[0]).toBe('run_started');
    expect(events[0]).toMatchObject({ prompt: 'legal rag chunking' });
    for (const needed of [
      'queries_drafted', 'query_scored', 'queries_submitted', 'search_started', 'search_results',
      'page_fetched', 'page_failed', 'page_judged', 'summary_done', 'report_delta', 'report_done', 'tldr_done',
    ]) {
      expect(t).toContain(needed);
    }
    expect(t.indexOf('queries_submitted')).toBeLessThan(t.indexOf('search_started'));
    expect(t.indexOf('summary_done')).toBeLessThan(t.indexOf('report_delta'));
    expect(t.indexOf('report_done')).toBeLessThan(t.indexOf('tldr_done'));
    expect(terminals(events)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'run_finished' });
    expect((events.at(-1) as any).costUsd).toBeGreaterThan(0);
    const report = events.find((e) => e.type === 'report_done') as any;
    expect(report.text).toContain('## Sources');
  });

  it('REVIEW FOCUS: when every search comes back empty, it says so and writes no invented report', async () => {
    const { events } = await drain(runPipeline('obscure topic', createFakeDeps({ noResults: true })));
    const report = events.find((e) => e.type === 'report_done') as any;
    expect(report.text).toMatch(/couldn't find usable sources/i);
    expect(types(events)).not.toContain('tldr_done');
    expect(types(events)).not.toContain('report_delta');
    expect(events.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('finishes without a TLDR when the TLDR model fails', async () => {
    const { events } = await drain(runPipeline('p', createFakeDeps({ failTldr: true })));
    expect(types(events)).not.toContain('tldr_done');
    expect(events.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('turns a planner failure into one run_failed and no run_finished', async () => {
    const { events } = await drain(runPipeline('p', createFakeDeps({ museError: new Error('OpenRouter 402: out of credits') })));
    expect(terminals(events)).toEqual([{ type: 'run_failed', message: 'OpenRouter 402: out of credits' }]);
  });

  it('reports a time-limit message when the run was aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const { events } = await drain(runPipeline('p', createFakeDeps({ signal: ac.signal })));
    expect(terminals(events)).toEqual([{ type: 'run_failed', message: 'The run hit its time limit before it could finish.' }]);
  });
});
