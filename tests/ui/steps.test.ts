import { describe, it, expect } from 'vitest';
import { applyEvent, initialRunView, type RunView } from '@/lib/events/reducer';
import type { EventBody, RunEvent } from '@/lib/events/schema';
import { deriveSteps } from '@/lib/ui/steps';

function fold(bodies: EventBody[]): RunView {
  return bodies.reduce<RunView>((view, body, i) => applyEvent(view, { runId: 'r', seq: i + 1, ts: i, ...body } as RunEvent), initialRunView);
}
const statuses = (v: RunView) => Object.fromEntries(deriveSteps(v).map((s) => [s.key, s.status]));

const start: EventBody = { type: 'run_started', prompt: 'p' };
const drafted: EventBody[] = [
  { type: 'queries_drafting', round: 1 },
  { type: 'queries_drafted', round: 1, queries: ['a', 'b'] },
];
const submitted: EventBody = { type: 'queries_submitted', queries: ['a', 'b'], capped: false };
const searchStarted: EventBody[] = [{ type: 'search_started', query: 'a' }, { type: 'search_started', query: 'b' }];
const searchDone: EventBody[] = [
  { type: 'search_results', query: 'a', results: [{ url: 'https://x.test/1', title: 'X' }] },
  { type: 'search_results', query: 'b', results: [] },
];

describe('deriveSteps', () => {
  it('starts with every step pending, interactive included, before the run begins', () => {
    const steps = deriveSteps(initialRunView);
    expect(steps.map((s) => s.key)).toEqual(['plan', 'search', 'read', 'write', 'interactive']);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('walks plan, search, read, write and interactive in order', () => {
    expect(statuses(fold([start]))).toMatchObject({ plan: 'active', search: 'pending' });
    expect(statuses(fold([start, ...drafted]))).toMatchObject({ plan: 'active' });
    expect(statuses(fold([start, ...drafted, submitted]))).toMatchObject({ plan: 'completed', search: 'pending' });
    expect(statuses(fold([start, ...drafted, submitted, ...searchStarted]))).toMatchObject({ plan: 'completed', search: 'active', read: 'pending' });
    expect(statuses(fold([start, ...drafted, submitted, ...searchStarted, ...searchDone]))).toMatchObject({ search: 'completed', read: 'active', write: 'pending' });

    const writing = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'report_delta', text: 'Hi' }]);
    expect(statuses(writing)).toMatchObject({ read: 'completed', write: 'active', interactive: 'pending' });

    const reportDone = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'report_done', text: 'Hi' }]);
    expect(statuses(reportDone)).toMatchObject({ write: 'completed', interactive: 'pending' });

    const building = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'report_done', text: 'Hi' }, { type: 'artifact_started' }]);
    expect(statuses(building)).toMatchObject({ interactive: 'active' });

    const ready = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'report_done', text: 'Hi' }, { type: 'artifact_started' }, { type: 'artifact_done', html: '<html></html>' }, { type: 'run_finished', costUsd: 0.01 }]);
    expect(statuses(ready)).toEqual({ plan: 'completed', search: 'completed', read: 'completed', write: 'completed', interactive: 'completed' });
  });

  it('marks the step that was in progress as an error when the run fails or is interrupted', () => {
    const failedInRead = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'run_failed', message: 'boom' }]);
    expect(statuses(failedInRead)).toMatchObject({ plan: 'completed', search: 'completed', read: 'error', write: 'pending' });
    const failedEarly = fold([start, { type: 'run_failed', message: 'no credits' }]);
    expect(statuses(failedEarly)).toMatchObject({ plan: 'error' });
  });

  it('shows a failed or skipped artifact as an error step with its reason, without failing the run', () => {
    const view = fold([start, ...drafted, submitted, ...searchStarted, ...searchDone, { type: 'report_done', text: 'Hi' }, { type: 'artifact_failed', reason: 'skipped: not enough time left in this run' }, { type: 'run_finished', costUsd: 0 }]);
    const interactive = deriveSteps(view).find((s) => s.key === 'interactive')!;
    expect(interactive.status).toBe('error');
    expect(interactive.summary).toMatch(/skipped/i);
    expect(view.status).toBe('finished');
  });

  it('REVIEW FOCUS: a finished run recorded before artifacts existed has no interactive step', () => {
    const old = fold([start, { type: 'report_done', text: 'old' }, { type: 'run_finished', costUsd: 0.01 }]);
    expect(deriveSteps(old).map((s) => s.key)).toEqual(['plan', 'search', 'read', 'write']);
  });

  it('summaries describe progress in words', () => {
    const view = fold([start, ...drafted, submitted]);
    const plan = deriveSteps(view).find((s) => s.key === 'plan')!;
    expect(plan.summary).toBe('2 queries');
  });
});
