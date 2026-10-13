import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkCitations } from '@/lib/report/citations';

function tree(md: string, max: number) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, { max });
  return processor.runSync(processor.parse(md)) as any;
}

/** Flattens a paragraph's children into "t:<text>" / "c:<n>" / "<nodeType>" tokens. */
function tokens(node: any): string[] {
  const out: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'text') out.push(`t:${child.value}`);
    else if (child.type === 'citationRef') out.push(`c:${child.data.hProperties.n}`);
    else out.push(child.type);
  }
  return out;
}
const firstParagraph = (md: string, max: number) => tokens(tree(md, max).children[0]);

describe('remarkCitations', () => {
  it('turns valid markers into citation nodes and keeps the text around them', () => {
    expect(firstParagraph('Chunking helps [1] and more [2].', 2)).toEqual(['t:Chunking helps ', 'c:1', 't: and more ', 'c:2', 't:.']);
  });

  it('REVIEW FOCUS: leaves an out-of-range marker as plain text', () => {
    expect(firstParagraph('Not a source [9].', 3)).toEqual(['t:Not a source [9].']);
    expect(firstParagraph('Nothing to cite [1].', 0)).toEqual(['t:Nothing to cite [1].']);
  });

  it('REVIEW FOCUS: handles adjacent markers and comma lists', () => {
    expect(firstParagraph('Both [1][2] agree.', 2)).toEqual(['t:Both ', 'c:1', 'c:2', 't: agree.']);
    expect(firstParagraph('Several [1, 2] and [1,3].', 3)).toEqual(['t:Several ', 'c:1', 'c:2', 't: and ', 'c:1', 'c:3', 't:.']);
  });

  it('leaves a whole list untouched when any number in it is out of range', () => {
    expect(firstParagraph('Mixed [1, 9].', 3)).toEqual(['t:Mixed [1, 9].']);
  });

  it('REVIEW FOCUS: never touches inline code, fenced code or real links', () => {
    expect(firstParagraph('Use `[1]` here.', 3)).toEqual(['t:Use ', 'inlineCode', 't: here.']);
    const t = tree('```\nlook [1]\n```\n\n[1](https://x.test)', 3);
    expect(t.children[0].type).toBe('code');
    expect(t.children[0].value).toBe('look [1]');
    const link = tokens(t.children[1]);
    expect(link).toEqual(['link']);
  });

  it('works inside lists, headings and table cells', () => {
    const t = tree('- item [1]\n\n## Head [2]\n\n| a |\n|---|\n| cell [3] |', 3);
    const found: number[] = [];
    (function walk(n: any) {
      if (n.type === 'citationRef') found.push(n.data.hProperties.n);
      for (const c of n.children ?? []) walk(c);
    })(t);
    expect(found).toEqual([1, 2, 3]);
  });
});
