import { describe, it, expect } from 'vitest';
import { loadConfig, MAX_DURATION_SECONDS } from '@/lib/config';

describe('loadConfig', () => {
  it('returns the spec defaults', () => {
    const c = loadConfig({});
    expect(c.models).toEqual({
      planner: 'meta/muse-spark-1.3-contributor',
      classify: 'scaledown/classify-1',
      extract: 'scaledown/extract',
      summarize: 'scaledown/summarize',
    });
    expect(c.tldrModel).toBe('extract');
    expect(c.limits.runsPerDevicePerDay).toBe(5);
    expect(c.limits.ipMultiplier).toBe(3);
    expect(c.limits.dailySpendCapUsd).toBe(5);
    expect(c.limits.maxQueries).toBe(8);
    expect(c.limits.maxPages).toBe(30);
    expect(c.limits.maxPageChars).toBe(200_000);
    expect(c.scoring.maxRounds).toBe(3);
    expect(c.reasoning).toEqual({ plan: 'minimal', report: 'low', artifact: 'low' });
    expect(c.artifact).toEqual({ minRemainingMs: 100_000, maxMs: 150_000, maxTokens: 16_000, maxChars: 150_000 });
    expect(c.report.maxTokens).toBe(8000);
    expect(c.retry).toEqual({ retries: 1, baseMs: 400, museRetries: 2 });
    expect(c.maxFunctionMs).toBe(MAX_DURATION_SECONDS * 1000);
    expect(c.maxRunMs).toBeLessThan(c.maxFunctionMs);
  });

  it('applies env overrides', () => {
    const c = loadConfig({
      DAILY_SPEND_CAP_USD: '2.5',
      RUNS_PER_DEVICE_PER_DAY: '2',
      SEARCH_BUDGET_PER_DAY: '40',
      TLDR_MODEL: 'summarize',
      PLANNER_MODEL: 'meta/muse-spark-1.3',
      MUSE_REPORT_EFFORT: 'high',
      MUSE_ARTIFACT_EFFORT: 'medium',
    });
    expect(c.limits.dailySpendCapUsd).toBe(2.5);
    expect(c.limits.runsPerDevicePerDay).toBe(2);
    expect(c.limits.dailySearchBudget).toBe(40);
    expect(c.tldrModel).toBe('summarize');
    expect(c.models.planner).toBe('meta/muse-spark-1.3');
    expect(c.reasoning.report).toBe('high');
    expect(c.reasoning.artifact).toBe('medium');
  });

  it('throws on a malformed number or unknown TLDR model instead of silently using a default', () => {
    expect(() => loadConfig({ DAILY_SPEND_CAP_USD: 'five' })).toThrow(/DAILY_SPEND_CAP_USD/);
    expect(() => loadConfig({ TLDR_MODEL: 'gpt' })).toThrow(/TLDR_MODEL/);
    expect(() => loadConfig({ MUSE_PLAN_EFFORT: 'extreme' })).toThrow(/MUSE_PLAN_EFFORT/);
  });
});
