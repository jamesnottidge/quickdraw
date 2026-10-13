import { describe, it, expect } from 'vitest';
import { closeOpenFences } from '@/lib/markdown/closeOpenFences';

const F = '```';

describe('closeOpenFences', () => {
  it('leaves text without fences unchanged', () => {
    expect(closeOpenFences('# Title\n\nSome text with `inline` code.')).toBe('# Title\n\nSome text with `inline` code.');
  });

  it('closes a fence that is still open', () => {
    expect(closeOpenFences(`Intro\n\n${F}ts\nconst a = 1;`)).toBe(`Intro\n\n${F}ts\nconst a = 1;\n${F}`);
  });

  it('leaves a properly closed fence alone', () => {
    const md = `${F}ts\nx\n${F}\n\nafter`;
    expect(closeOpenFences(md)).toBe(md);
  });

  it('handles tilde fences', () => {
    expect(closeOpenFences('~~~\ncode')).toBe('~~~\ncode\n~~~');
  });

  it('does not let a shorter inner fence close a longer outer one', () => {
    const md = `\`\`\`\`md\n${F}js\nx\n${F}`;
    expect(closeOpenFences(md)).toBe(`${md}\n\`\`\`\``);
  });

  it('ignores backticks that are not at the start of a line', () => {
    expect(closeOpenFences(`Use ${F} inline here`)).toBe(`Use ${F} inline here`);
  });

  it('does not treat a fence with an info string as a closing fence', () => {
    const md = `${F}\nfirst\n${F}ts\nstill code`;
    expect(closeOpenFences(md)).toBe(`${md}\n${F}`);
  });

  it('is idempotent', () => {
    const once = closeOpenFences(`${F}ts\nunfinished`);
    expect(closeOpenFences(once)).toBe(once);
  });
});
