import { describe, it, expect } from 'vitest';
import { ARTIFACT_SANDBOX, FORBIDDEN_SANDBOX_TOKENS } from '@/lib/artifact/sandbox';

describe('artifact sandbox', () => {
  it('REVIEW FOCUS: allows scripts and nothing else', () => {
    expect(ARTIFACT_SANDBOX).toBe('allow-scripts');
    const tokens = ARTIFACT_SANDBOX.split(/\s+/);
    for (const forbidden of FORBIDDEN_SANDBOX_TOKENS) expect(tokens).not.toContain(forbidden);
  });
  it('lists every escape hatch we must never grant', () => {
    for (const t of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals']) {
      expect(FORBIDDEN_SANDBOX_TOKENS).toContain(t);
    }
  });
});
