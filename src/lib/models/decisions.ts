import { z } from 'zod';
import type { AppConfig } from '@/lib/config';
import type { Band } from '@/lib/events/schema';
import { postJson } from '@/lib/http/postJson';
import {
  INTENT_CRITERIA,
  INTENT_INSTRUCTION,
  RELEVANCE_CRITERIA,
  SPECIFICITY_CRITERIA,
  SPECIFICITY_INSTRUCTION,
  relevanceInstruction,
} from '@/lib/prompts';
import type { ModelCtx, Stage } from './types';

export interface QueryScore {
  query: string;
  score: number;
  confidence: number;
  band: Band;
}

export interface RelevanceResult {
  relevance: number;
  relevant: boolean;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const usageOf = (j: unknown) => {
  const u = (j as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  return { inputTokens: n(u.input_tokens), outputTokens: n(u.output_tokens), costUsd: n(u.cost) };
};

const responseSchema = z.object({ answers: z.record(z.string(), z.unknown()) });
const scoreAnswer = z.object({ type: z.literal('score'), score: z.number(), confidence: z.number() });
const noulAnswer = z.object({ type: z.literal('noul'), noul: z.number() });

async function decide(
  ctx: ModelCtx,
  cfg: AppConfig,
  stage: Stage,
  text: string,
  questions: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const model = cfg.models.classify;
  const json = await postJson<unknown>({
    ctx,
    path: '/alpha/decisions',
    body: { model, state: { text }, questions },
    stage,
    model,
    usage: usageOf,
  });
  return responseSchema.parse(json).answers;
}

export function bandFor(score: number, s: AppConfig['scoring']): Band {
  if (score < s.vagueBelow) return 'vague';
  if (score >= s.preciseFrom) return 'precise';
  return 'focused';
}

export async function scoreQuery(ctx: ModelCtx, cfg: AppConfig, query: string): Promise<QueryScore> {
  const answers = await decide(ctx, cfg, 'score_query', `Search query: ${query}`, {
    specificity: { type: 'score', instructions: SPECIFICITY_INSTRUCTION, criteria: SPECIFICITY_CRITERIA },
  });
  const a = scoreAnswer.parse(answers.specificity);
  return { query, score: a.score, confidence: a.confidence, band: bandFor(a.score, cfg.scoring) };
}

export async function judgeRelevance(
  ctx: ModelCtx,
  cfg: AppConfig,
  question: string,
  pageText: string,
): Promise<RelevanceResult> {
  const answers = await decide(ctx, cfg, 'judge_relevance', pageText.slice(0, cfg.relevance.maxChars), {
    relevant: { type: 'noul', instructions: relevanceInstruction(question), criteria: RELEVANCE_CRITERIA },
  });
  const a = noulAnswer.parse(answers.relevant);
  return { relevance: a.noul, relevant: a.noul >= cfg.relevance.threshold };
}

/** Is this message a research question? The text is capped so a huge paste cannot inflate the call. */
export async function classifyIntent(ctx: ModelCtx, cfg: AppConfig, message: string): Promise<{ research: boolean; score: number }> {
  const answers = await decide(ctx, cfg, 'intent', message.slice(0, 4000), {
    research: { type: 'noul', instructions: INTENT_INSTRUCTION, criteria: INTENT_CRITERIA },
  });
  const a = noulAnswer.parse(answers.research);
  return { research: a.noul >= 0.5, score: a.noul };
}
