import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe('client bundle guard', () => {
  it('REVIEW (final): nothing in src pulls in the heavy markdown/diagram/highlighter stack that the app never renders', () => {
    const heavy = /from\s+['"](streamdown|@streamdown\/[^'"]+|mermaid|katex|shiki|rehype-katex)['"]/;
    const offenders = sourceFiles(path.join(process.cwd(), 'src')).filter((f) => heavy.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
