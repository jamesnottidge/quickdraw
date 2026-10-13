import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_DURATION_SECONDS } from '@/lib/config';

describe('route segment config', () => {
  it('keeps the literal maxDuration in the run route equal to MAX_DURATION_SECONDS (Next needs a literal)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/run/route.ts'), 'utf8');
    expect(src).toContain(`export const maxDuration = ${MAX_DURATION_SECONDS};`);
  });
});
