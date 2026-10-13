import { describe, it, expect } from 'vitest';
import { applyEvent, initialRunView, markStreamEnded } from '@/lib/events/reducer';
import { parseRunEvent, type EventBody, type RunEvent } from '@/lib/events/schema';

const ev = (seq: number, body: EventBody): RunEvent => ({ runId: 'r1', seq, ts: seq * 1000, ...body });
const fold = (events: RunEvent[]) => events.reduce((s, e) => applyEvent(s, e), initialRunView);

const url = 'https://x.test/1';

describe('applyEvent', () => {
  it('folds a full run into a view', () => {
    const view = fold([
      ev(1, { type: 'run_started', prompt: 'p' }),
      ev(2, { type: 'queries_drafting', round: 1 }),
      ev(3, { type: 'queries_drafted', round: 1, queries: ['a', 'b'] }),
      ev(4, { type: 'query_scored', round: 1, query: 'a', score: 0.4, band: 'vague', confidence: 0.77 }),
      ev(5, { type: 'query_scored', round: 1, query: 'b', score: 2.8, band: 'precise', confidence: 0.9 }),
      ev(6, { type: 'queries_submitted', queries: ['b'], capped: false }),
      ev(7, { type: 'search_started', query: 'b' }),
      ev(8, { type: 'search_results', query: 'b', results: [{ url, title: 'X' }] }),
      ev(9, { type: 'page_fetched', url, title: 'X', chars: 900, contentType: 'text/html' }),
      ev(10, { type: 'page_judged', url, relevance: 0.9, relevant: true }),
      ev(11, { type: 'summary_done', url, title: 'X', summary: 'sum' }),
      ev(12, { type: 'report_delta', text: 'Hello ' }),
      ev(13, { type: 'report_delta', text: 'wor' }),
      ev(14, { type: 'report_done', text: 'Hello world' }),
      ev(15, { type: 'tldr_done', text: 'TL' }),
      ev(16, { type: 'run_finished', costUsd: 0.01 }),
    ]);
    expect(view.status).toBe('finished');
    expect(view.prompt).toBe('p');
    expect(view.rounds[0].scores.a.band).toBe('vague');
    expect(view.rounds[0].drafting).toBe(false);
    expect(view.submitted).toEqual(['b']);
    expect(view.searches.b).toEqual([{ url, title: 'X' }]);
    expect(view.pages[url].status).toBe('summarized');
    expect(view.pages[url].summary).toBe('sum');
    expect(view.report).toBe('Hello world');
    expect(view.reportDone).toBe(true);
    expect(view.tldr).toBe('TL');
    expect(view.costUsd).toBe(0.01);
  });

  it('ignores duplicate and replayed events (same state object)', () => {
    const e1 = ev(1, { type: 'run_started', prompt: 'p' });
    const s1 = applyEvent(initialRunView, e1);
    expect(applyEvent(s1, e1)).toBe(s1);
  });

  it('marks the run interrupted on a gap and stays interrupted', () => {
    const s1 = applyEvent(initialRunView, ev(1, { type: 'run_started', prompt: 'p' }));
    const s3 = applyEvent(s1, ev(3, { type: 'report_delta', text: 'x' }));
    expect(s3.status).toBe('interrupted');
    expect(s3.error).toMatch(/Missing events/);
    const after = applyEvent(s3, ev(2, { type: 'report_delta', text: 'y' }));
    expect(after).toBe(s3);
  });

  it('report_done replaces the accumulated deltas', () => {
    const view = fold([
      ev(1, { type: 'run_started', prompt: 'p' }),
      ev(2, { type: 'report_delta', text: 'partial garb' }),
      ev(3, { type: 'report_done', text: 'The authoritative report' }),
    ]);
    expect(view.report).toBe('The authoritative report');
  });

  it('run_failed sets failed and later events are ignored', () => {
    const s = fold([
      ev(1, { type: 'run_started', prompt: 'p' }),
      ev(2, { type: 'run_failed', message: 'boom' }),
    ]);
    expect(s.status).toBe('failed');
    expect(s.error).toBe('boom');
    expect(applyEvent(s, ev(3, { type: 'report_delta', text: 'late' }))).toBe(s);
  });

  it('records page failures with a reason', () => {
    const s = fold([
      ev(1, { type: 'run_started', prompt: 'p' }),
      ev(2, { type: 'page_failed', url, reason: 'HTTP 403' }),
    ]);
    expect(s.pages[url]).toMatchObject({ status: 'failed', reason: 'HTTP 403' });
    expect(s.pageOrder).toEqual([url]);
  });
});

describe('markStreamEnded', () => {
  it('turns a running view into interrupted, never into done', () => {
    const running = applyEvent(initialRunView, ev(1, { type: 'run_started', prompt: 'p' }));
    const ended = markStreamEnded(running);
    expect(ended.status).toBe('interrupted');
    expect(ended.error).toMatch(/ended/i);
  });
  it('leaves finished, failed and idle views alone', () => {
    const fin = fold([ev(1, { type: 'run_started', prompt: 'p' }), ev(2, { type: 'run_finished', costUsd: 0 })]);
    expect(markStreamEnded(fin)).toBe(fin);
    expect(markStreamEnded(initialRunView)).toBe(initialRunView);
  });
});

describe('parseRunEvent', () => {
  it('accepts a valid event and rejects unknown types or missing fields', () => {
    expect(parseRunEvent(ev(1, { type: 'run_started', prompt: 'p' })).type).toBe('run_started');
    expect(() => parseRunEvent({ runId: 'r', seq: 1, ts: 1, type: 'nope' })).toThrow();
    expect(() => parseRunEvent({ runId: 'r', seq: 1, ts: 1, type: 'report_delta' })).toThrow();
  });
});
