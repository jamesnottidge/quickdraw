import { describe, it, expect } from 'vitest';
import { createFakeDeps } from '@/lib/pipeline/fakes';
import { runPipeline } from '@/lib/pipeline/run';
import type { ModelCallRecord } from '@/lib/models/types';
import { drain } from '../helpers/gen';

describe('createFakeDeps record option', () => {
  it('records a plausible model call for every stage a real run uses', async () => {
    const records: ModelCallRecord[] = [];
    await drain(runPipeline('p', createFakeDeps({ record: (r) => { records.push(r); } })));
    const stages = new Set(records.map((r) => r.stage));
    for (const s of ['plan', 'score_query', 'judge_relevance', 'summarize', 'report', 'tldr', 'artifact']) expect(stages.has(s as never)).toBe(true);
    for (const r of records) {
      expect(r.httpStatus).toBe(200);
      expect(r.latencyMs).toBeGreaterThan(0);
      expect(r.inputTokens).toBeGreaterThan(0);
      expect(r.costUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('records nothing when no recorder is given', async () => {
    await expect(drain(runPipeline('p', createFakeDeps()))).resolves.toBeDefined();
  });
});
