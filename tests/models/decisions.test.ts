import { describe, it, expect } from 'vitest';
import { bandFor, classifyIntent, judgeRelevance, scoreQuery } from '@/lib/models/decisions';
import { loadConfig } from '@/lib/config';
import { SPECIFICITY_CRITERIA } from '@/lib/prompts';
import { HttpError } from '@/lib/http/errors';
import { jsonResponse, testCtx } from '../helpers/http';

const cfg = loadConfig({});

const scoreBody = (score: number) => ({
  id: 'gen-dec-1',
  model: 'scaledown/classify-1-20260928',
  provider: 'ScaleDown',
  answers: {
    specificity: {
      type: 'score',
      score,
      confidence: 0.9,
      legend: {},
      probabilities: { '0': 0.05, '1': 0.05, '2': 0.2, '3': 0.7 },
    },
  },
  usage: { input_tokens: 330, output_tokens: 1, cost: 0.0000132 },
});

const nulBody = (p: number) => ({
  answers: { relevant: { type: 'noul', noul: p } },
  usage: { input_tokens: 500, output_tokens: 1, cost: 0.00002 },
});

describe('bandFor', () => {
  it('maps scores to bands using the configured boundaries', () => {
    expect(bandFor(0, cfg.scoring)).toBe('vague');
    expect(bandFor(1.49, cfg.scoring)).toBe('vague');
    expect(bandFor(1.5, cfg.scoring)).toBe('focused');
    expect(bandFor(2.39, cfg.scoring)).toBe('focused');
    expect(bandFor(2.4, cfg.scoring)).toBe('precise');
  });
});

describe('scoreQuery', () => {
  it('asks one score question on the Decisions API and returns score, confidence and band', async () => {
    const { ctx, calls, records } = testCtx(() => jsonResponse(scoreBody(2.76)));
    const out = await scoreQuery(ctx, cfg, 'SEC 10-K risk factors NVIDIA fiscal 2025');
    expect(out).toEqual({ query: 'SEC 10-K risk factors NVIDIA fiscal 2025', score: 2.76, confidence: 0.9, band: 'precise' });
    expect(calls[0].url).toBe('https://openrouter.test/api/alpha/decisions');
    expect(calls[0].body.model).toBe('scaledown/classify-1');
    expect(calls[0].body.state).toEqual({ text: 'Search query: SEC 10-K risk factors NVIDIA fiscal 2025' });
    expect(calls[0].body.questions.specificity.type).toBe('score');
    expect(calls[0].body.questions.specificity.criteria).toEqual(SPECIFICITY_CRITERIA);
    expect(records[0]).toMatchObject({ stage: 'score_query', model: 'scaledown/classify-1', inputTokens: 330, costUsd: 0.0000132 });
  });

  it('throws HttpError on a 400 and rejects a malformed answer', async () => {
    const bad = testCtx(() => jsonResponse({ error: { message: 'x' } }, 400));
    await expect(scoreQuery(bad.ctx, cfg, 'q')).rejects.toBeInstanceOf(HttpError);
    const odd = testCtx(() => jsonResponse({ answers: { specificity: { type: 'score' } } }));
    await expect(scoreQuery(odd.ctx, cfg, 'q')).rejects.toThrow();
  });
});

describe('judgeRelevance', () => {
  it('puts the research question in instructions (never in state) and uses true/false criteria', async () => {
    const { ctx, calls, records } = testCtx(() => jsonResponse(nulBody(0.9)));
    const out = await judgeRelevance(ctx, cfg, 'How does chunking affect legal RAG?', 'PAGE TEXT');
    expect(out).toEqual({ relevance: 0.9, relevant: true });
    const q = calls[0].body.questions.relevant;
    expect(q.type).toBe('noul');
    expect(q.instructions).toContain('How does chunking affect legal RAG?');
    expect(Object.keys(q.criteria).sort()).toEqual(['false', 'true']);
    expect(calls[0].body.state).toEqual({ text: 'PAGE TEXT' });
    expect(records[0].stage).toBe('judge_relevance');
  });

  it('truncates the page to relevance.maxChars', async () => {
    const { ctx, calls } = testCtx(() => jsonResponse(nulBody(0.1)));
    await judgeRelevance(ctx, cfg, 'q', 'x'.repeat(cfg.relevance.maxChars + 5000));
    expect(calls[0].body.state.text).toHaveLength(cfg.relevance.maxChars);
  });

  it('applies the relevance threshold', async () => {
    const hi = testCtx(() => jsonResponse(nulBody(cfg.relevance.threshold)));
    expect((await judgeRelevance(hi.ctx, cfg, 'q', 't')).relevant).toBe(true);
    const lo = testCtx(() => jsonResponse(nulBody(cfg.relevance.threshold - 0.01)));
    expect((await judgeRelevance(lo.ctx, cfg, 'q', 't')).relevant).toBe(false);
  });
});

describe('classifyIntent', () => {
  const body = (p: number) => ({ answers: { research: { type: 'noul', noul: p } }, usage: { input_tokens: 200, output_tokens: 1, cost: 0.00001 } });

  it('asks one research-or-not question and thresholds the probability at 0.5', async () => {
    const yes = testCtx(() => jsonResponse(body(0.9)));
    expect(await classifyIntent(yes.ctx, cfg, 'How do honeybees navigate?')).toEqual({ research: true, score: 0.9 });
    expect(yes.calls[0].body.state).toEqual({ text: 'How do honeybees navigate?' });
    expect(yes.calls[0].body.questions.research.type).toBe('noul');
    expect(yes.records[0].stage).toBe('intent');
    const no = testCtx(() => jsonResponse(body(0.03)));
    expect(await classifyIntent(no.ctx, cfg, 'hi')).toEqual({ research: false, score: 0.03 });
  });

  it('caps a huge paste before sending it', async () => {
    const { ctx, calls } = testCtx(() => jsonResponse(body(0.1)));
    await classifyIntent(ctx, cfg, 'x'.repeat(50_000));
    expect(calls[0].body.state.text).toHaveLength(4000);
  });
});
