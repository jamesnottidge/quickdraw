import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '@/lib/fetch/html';

const para = '<p>Section aware chunking keeps clauses and their cross references together, which improves retrieval accuracy for long contracts and statutes.</p>';
const page = `<!doctype html><html><head><title>Chunking in Legal RAG</title></head><body>
<nav>Home | About | Login</nav>
<article><h1>Chunking in Legal RAG</h1>${para.repeat(8)}<h2>Results</h2><ul><li>Recall improved</li><li>Fewer hallucinated citations</li></ul></article>
<footer>Copyright Example Corp</footer></body></html>`;

describe('htmlToMarkdown', () => {
  it('extracts the title and article body as markdown', () => {
    const { title, markdown } = htmlToMarkdown(page);
    expect(title).toBe('Chunking in Legal RAG');
    expect(markdown).toContain('Section aware chunking');
    expect(markdown).toContain('## Results');
    expect(markdown).toMatch(/-\s+Recall improved/);
    expect(markdown.length).toBeGreaterThan(400);
  });

  it('reports readable text length separately from markdown length (links inflate markdown)', () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="https://example.com/a/very/long/path/number/${i}">go</a>`).join(' ');
    const { markdown, textChars } = htmlToMarkdown(`<html><body><nav>${links}</nav><p>Hi</p></body></html>`);
    expect(textChars).toBeLessThan(40);
    expect(markdown.length).toBeGreaterThan(200);
  });

  it('removes scripts and NUL characters', () => {
    const { markdown } = htmlToMarkdown(`<html><body><script>alert(1)</script><p>Hello\u0000 world</p></body></html>`);
    expect(markdown).not.toContain('alert');
    expect(markdown).not.toContain('\u0000');
    expect(markdown).toContain('Hello');
  });

  it('falls back to the body when no article is detected', () => {
    const { markdown } = htmlToMarkdown('<html><body><p>Short page text</p></body></html>');
    expect(markdown).toContain('Short page text');
  });
});
