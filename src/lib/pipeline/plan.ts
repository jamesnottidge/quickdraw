import type { AppConfig } from '@/lib/config';
import type { EventBody } from '@/lib/events/schema';
import type { QueryScore } from '@/lib/models/decisions';
import type { MuseEvent, MuseMessage, MuseRequest } from '@/lib/models/muse';
import type { CompleteToolCall, InvalidToolCall } from '@/lib/models/toolcall-accumulator';
import { PLANNER_SYSTEM } from '@/lib/prompts';
import { planTools, queriesArgs } from './tools';

export interface PlanDeps {
  config: AppConfig;
  muse: (req: MuseRequest) => AsyncIterable<MuseEvent>;
  scoreQuery: (query: string) => Promise<QueryScore>;
}

export function normalizeQueries(raw: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const t = q.replace(/\s+/g, ' ').trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const errorResult = (id: string, message: string) => ({ id, content: JSON.stringify({ error: message }) });

export async function* planQueries(prompt: string, deps: PlanDeps): AsyncGenerator<EventBody, string[]> {
  const { config } = deps;
  const messages: MuseMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM },
    { role: 'user', content: prompt },
  ];
  const maxSteps = config.scoring.maxRounds * 2 + 4;
  let rounds = 0;
  let capReported = false;
  let nudges = 0;
  let lastScored: QueryScore[] = [];

  for (let step = 0; step < maxSteps; step++) {
    let text = '';
    const calls: CompleteToolCall[] = [];
    const invalid: InvalidToolCall[] = [];
    for await (const ev of deps.muse({ messages, tools: planTools, reasoningEffort: config.reasoning.plan })) {
      if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'tool_drafting') {
        if (ev.name === 'score_queries' && rounds < config.scoring.maxRounds) {
          yield { type: 'queries_drafting', round: rounds + 1 };
        }
      } else if (ev.type === 'tool_call') calls.push(ev.call);
      else if (ev.type === 'tool_call_invalid') invalid.push(ev.call);
    }

    if (calls.length === 0 && invalid.length === 0) {
      if (++nudges > 2) break;
      messages.push(
        { role: 'assistant', content: text || '(no response)' },
        { role: 'user', content: 'You must call a tool. Call submit_queries now with your final queries.' },
      );
      continue;
    }

    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: [
        ...calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.rawArgs } })),
        // never replay malformed JSON to the provider; the error goes in the tool result
        ...invalid.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name || 'unknown', arguments: '{}' } })),
      ],
    });

    const results: { id: string; content: string }[] = [];
    for (const bad of invalid) {
      results.push(errorResult(bad.id, `Invalid tool call: ${bad.error}. Call the tool again with valid JSON arguments.`));
    }

    for (const call of calls) {
      if (call.name !== 'submit_queries' && call.name !== 'score_queries') {
        results.push(errorResult(call.id, `Unknown tool "${call.name}". Use score_queries or submit_queries.`));
        continue;
      }
      const parsed = queriesArgs.safeParse(call.args);
      const queries = parsed.success ? normalizeQueries(parsed.data.queries, config.limits.maxQueries) : [];
      if (queries.length === 0) {
        results.push(errorResult(call.id, `${call.name} needs a non-empty "queries" array of strings.`));
        continue;
      }

      if (call.name === 'submit_queries') {
        yield { type: 'queries_submitted', queries, capped: false };
        return queries;
      }

      if (rounds >= config.scoring.maxRounds) {
        if (!capReported) {
          capReported = true;
          yield { type: 'plan_cap_hit', round: rounds };
        }
        results.push(errorResult(call.id, 'Scoring limit reached. Call submit_queries now with your final queries.'));
        continue;
      }

      rounds++;
      yield { type: 'queries_drafted', round: rounds, queries };
      const settled = await Promise.allSettled(queries.map((q) => deps.scoreQuery(q)));
      const out: unknown[] = [];
      const scored: QueryScore[] = [];
      for (let i = 0; i < queries.length; i++) {
        const s = settled[i];
        if (s.status === 'fulfilled') {
          scored.push(s.value);
          yield {
            type: 'query_scored',
            round: rounds,
            query: queries[i],
            score: s.value.score,
            band: s.value.band,
            confidence: s.value.confidence,
          };
          out.push({ query: queries[i], score: round1(s.value.score), band: s.value.band });
        } else {
          out.push({ query: queries[i], error: 'scoring unavailable' });
        }
      }
      if (scored.length) lastScored = scored;
      results.push({ id: call.id, content: JSON.stringify(out) });
    }

    for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }

  const fallback = lastScored.length
    ? [...lastScored].sort((a, b) => b.score - a.score).slice(0, 5).map((s) => s.query)
    : normalizeQueries([prompt.slice(0, 200)], 1);
  if (!capReported) yield { type: 'plan_cap_hit', round: rounds };
  yield { type: 'queries_submitted', queries: fallback, capped: true };
  return fallback;
}
