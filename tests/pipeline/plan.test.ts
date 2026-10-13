import { describe, it, expect } from 'vitest';
import { normalizeQueries, planQueries, type PlanDeps } from '@/lib/pipeline/plan';
import type { MuseEvent, MuseMessage, MuseRequest } from '@/lib/models/muse';
import { bandFor } from '@/lib/models/decisions';
import { loadConfig } from '@/lib/config';
import { drain } from '../helpers/gen';

const config = loadConfig({});

const finish: MuseEvent = { type: 'finish', reason: 'tool_calls', costUsd: 0, inputTokens: 0, outputTokens: 0 };
const call = (id: string, name: string, args: unknown): MuseEvent[] => [
  { type: 'tool_drafting', name },
  { type: 'tool_call', call: { id, name, args, rawArgs: JSON.stringify(args) } },
  finish,
];
const textOnly = (t = 'hmm'): MuseEvent[] => [{ type: 'text', delta: t }, { ...finish, reason: 'stop' }];

function scripted(steps: MuseEvent[][]) {
  const seen: MuseMessage[][] = [];
  const reqs: MuseRequest[] = [];
  let i = 0;
  const muse = (req: MuseRequest): AsyncIterable<MuseEvent> => {
    reqs.push(req);
    seen.push(JSON.parse(JSON.stringify(req.messages)));
    const events = steps[i++] ?? textOnly();
    return (async function* () {
      for (const e of events) yield e;
    })();
  };
  return { muse, seen, reqs };
}

const scorer = (table: Record<string, number>, fail: string[] = []) => async (q: string) => {
  if (fail.includes(q)) throw new Error('classify down');
  const score = table[q] ?? 2.8;
  return { query: q, score, confidence: 0.9, band: bandFor(score, config.scoring) };
};

const deps = (steps: MuseEvent[][], table: Record<string, number> = {}, fail: string[] = []) => {
  const s = scripted(steps);
  const d: PlanDeps = { config, muse: s.muse, scoreQuery: scorer(table, fail) };
  return { d, seen: s.seen, reqs: s.reqs };
};

const types = (events: { type: string }[]) => events.map((e) => e.type);

describe('normalizeQueries', () => {
  it('trims, collapses whitespace, drops empties and case-insensitive duplicates, and caps the list', () => {
    expect(normalizeQueries(['  a   b ', 'A B', '', 'c'], 8)).toEqual(['a b', 'c']);
    expect(normalizeQueries(Array.from({ length: 12 }, (_, i) => `q${i}`), 8)).toHaveLength(8);
  });
});

describe('planQueries', () => {
  it('scores, revises a vague query, then submits', async () => {
    const { d, seen, reqs } = deps(
      [
        call('c1', 'score_queries', { queries: ['ai', 'legal rag chunking strategies 2025'] }),
        call('c2', 'score_queries', { queries: ['ai in legal contract review', 'legal rag chunking strategies 2025'] }),
        call('c3', 'submit_queries', { queries: ['ai in legal contract review', 'legal rag chunking strategies 2025'] }),
      ],
      { ai: 0.4 },
    );
    const { events, result } = await drain(planQueries('research legal rag', d));
    expect(types(events)).toEqual([
      'queries_drafting', 'queries_drafted', 'query_scored', 'query_scored',
      'queries_drafting', 'queries_drafted', 'query_scored', 'query_scored',
      'queries_submitted',
    ]);
    expect(result).toEqual(['ai in legal contract review', 'legal rag chunking strategies 2025']);
    expect(events.at(-1)).toEqual({ type: 'queries_submitted', queries: result, capped: false });
    // the model saw rounded scores and bands in the first tool result
    const toolMsg = seen[1].find((m) => m.role === 'tool') as { content: string };
    expect(JSON.parse(toolMsg.content)).toEqual([
      { query: 'ai', score: 0.4, band: 'vague' },
      { query: 'legal rag chunking strategies 2025', score: 2.8, band: 'precise' },
    ]);
    expect(reqs[0].reasoningEffort).toBe('minimal');
    expect(seen[0][0].role).toBe('system');
    expect(seen[0][1]).toEqual({ role: 'user', content: 'research legal rag' });
  });

  it('enforces the scoring-round cap: the extra round is refused, the cap is reported once', async () => {
    const score = call('c', 'score_queries', { queries: ['q1', 'q2'] });
    const { d, seen } = deps([score, score, score, score, call('s', 'submit_queries', { queries: ['q1'] })]);
    const { events, result } = await drain(planQueries('p', d));
    expect(events.filter((e) => e.type === 'queries_drafted')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'plan_cap_hit')).toHaveLength(1);
    expect(result).toEqual(['q1']);
    const refused = seen[4].filter((m) => m.role === 'tool').at(-1) as { content: string };
    expect(refused.content).toMatch(/limit reached/i);
  });

  it('REVIEW FOCUS: a model that never submits falls back to the best-scoring queries and says it was capped', async () => {
    const { d } = deps(
      [call('c1', 'score_queries', { queries: ['low', 'high', 'mid'] }), textOnly(), textOnly(), textOnly()],
      { low: 0.2, high: 2.9, mid: 1.8 },
    );
    const { events, result } = await drain(planQueries('p', d));
    expect(result).toEqual(['high', 'mid', 'low']);
    expect(types(events).slice(-2)).toEqual(['plan_cap_hit', 'queries_submitted']);
    expect(events.at(-1)).toMatchObject({ type: 'queries_submitted', capped: true });
  });

  it('REVIEW FOCUS: a model that ignores the tools entirely falls back to the prompt as the single query', async () => {
    const { d } = deps([textOnly(), textOnly(), textOnly(), textOnly()]);
    const { result } = await drain(planQueries('How do bees navigate?', d));
    expect(result).toEqual(['How do bees navigate?']);
  });

  it('REVIEW FOCUS: malformed tool arguments are returned to the model as an error, not executed', async () => {
    const bad: MuseEvent[] = [
      { type: 'tool_drafting', name: 'submit_queries' },
      { type: 'tool_call_invalid', call: { id: 'bad1', name: 'submit_queries', rawArgs: '{"queries":["a"', error: 'Arguments are not valid JSON' } },
      finish,
    ];
    const { d, seen } = deps([bad, call('c2', 'submit_queries', { queries: ['fixed query'] })]);
    const { events, result } = await drain(planQueries('p', d));
    expect(result).toEqual(['fixed query']);
    expect(types(events)).toEqual(['queries_submitted']);
    const assistant = seen[1].find((m) => m.role === 'assistant') as any;
    expect(assistant.tool_calls[0].function.arguments).toBe('{}');
    const tool = seen[1].find((m) => m.role === 'tool') as { tool_call_id: string; content: string };
    expect(tool.tool_call_id).toBe('bad1');
    expect(tool.content).toMatch(/Invalid tool call/);
  });

  it('nudges a text-only reply and accepts the submission that follows', async () => {
    const { d, seen } = deps([textOnly('Sure!'), call('c', 'submit_queries', { queries: ['final'] })]);
    const { result } = await drain(planQueries('p', d));
    expect(result).toEqual(['final']);
    const nudge = seen[1].at(-1) as { role: string; content: string };
    expect(nudge.role).toBe('user');
    expect(nudge.content).toMatch(/submit_queries/);
  });

  it('REVIEW FOCUS: an empty submit is refused and the model gets another try', async () => {
    const { d } = deps([call('c1', 'submit_queries', { queries: [] }), call('c2', 'submit_queries', { queries: ['ok'] })]);
    const { result } = await drain(planQueries('p', d));
    expect(result).toEqual(['ok']);
  });

  it('REVIEW FOCUS: duplicate and oversized submissions are deduped and capped at 8', async () => {
    const many = ['Dup', 'dup', ...Array.from({ length: 12 }, (_, i) => `query ${i}`)];
    const { d } = deps([call('c', 'submit_queries', { queries: many })]);
    const { events, result } = await drain(planQueries('p', d));
    expect(result).toHaveLength(8);
    expect(new Set(result.map((q) => q.toLowerCase())).size).toBe(8);
    expect(events.at(-1)).toMatchObject({ type: 'queries_submitted', queries: result });
  });

  it('survives a scoring failure for one query and tells the model it is unscored', async () => {
    const { d, seen } = deps(
      [call('c1', 'score_queries', { queries: ['good', 'broken'] }), call('c2', 'submit_queries', { queries: ['good'] })],
      {},
      ['broken'],
    );
    const { events } = await drain(planQueries('p', d));
    expect(events.filter((e) => e.type === 'query_scored')).toHaveLength(1);
    const toolMsg = seen[1].find((m) => m.role === 'tool') as { content: string };
    expect(JSON.parse(toolMsg.content)).toEqual([
      { query: 'good', score: 2.8, band: 'precise' },
      { query: 'broken', error: 'scoring unavailable' },
    ]);
  });

  it('answers an unknown tool with an error instead of crashing', async () => {
    const { d, seen } = deps([call('c1', 'delete_everything', {}), call('c2', 'submit_queries', { queries: ['x'] })]);
    const { result } = await drain(planQueries('p', d));
    expect(result).toEqual(['x']);
    const tool = seen[1].find((m) => m.role === 'tool') as { content: string };
    expect(tool.content).toMatch(/Unknown tool/);
  });
});
