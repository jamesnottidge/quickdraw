import { z } from 'zod';

export const bandSchema = z.enum(['vague', 'focused', 'precise']);
export type Band = z.infer<typeof bandSchema>;

const round = z.number().int().positive();

export const eventBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run_started'), prompt: z.string() }),
  z.object({ type: z.literal('queries_drafting'), round }),
  z.object({ type: z.literal('queries_drafted'), round, queries: z.array(z.string()) }),
  z.object({
    type: z.literal('query_scored'),
    round,
    query: z.string(),
    score: z.number(),
    band: bandSchema,
    confidence: z.number(),
  }),
  z.object({ type: z.literal('plan_cap_hit'), round: z.number().int().nonnegative() }),
  z.object({ type: z.literal('queries_submitted'), queries: z.array(z.string()), capped: z.boolean() }),
  z.object({ type: z.literal('search_started'), query: z.string() }),
  z.object({
    type: z.literal('search_results'),
    query: z.string(),
    results: z.array(z.object({ url: z.string(), title: z.string() })),
  }),
  z.object({
    type: z.literal('page_fetched'),
    url: z.string(),
    title: z.string(),
    chars: z.number().int().nonnegative(),
    contentType: z.string(),
  }),
  z.object({ type: z.literal('page_failed'), url: z.string(), reason: z.string() }),
  z.object({ type: z.literal('page_judged'), url: z.string(), relevance: z.number(), relevant: z.boolean() }),
  z.object({ type: z.literal('summary_done'), url: z.string(), title: z.string(), summary: z.string() }),
  z.object({ type: z.literal('report_delta'), text: z.string() }),
  z.object({ type: z.literal('report_done'), text: z.string() }),
  z.object({ type: z.literal('tldr_done'), text: z.string() }),
  z.object({ type: z.literal('run_finished'), costUsd: z.number() }),
  z.object({ type: z.literal('run_failed'), message: z.string() }),
]);

export type EventBody = z.infer<typeof eventBodySchema>;

export const envelopeSchema = z.object({
  runId: z.string(),
  seq: z.number().int().positive(),
  ts: z.number(),
});

export type RunEvent = z.infer<typeof envelopeSchema> & EventBody;

export function parseRunEvent(json: unknown): RunEvent {
  const envelope = envelopeSchema.parse(json);
  const body = eventBodySchema.parse(json);
  return { ...envelope, ...body };
}
