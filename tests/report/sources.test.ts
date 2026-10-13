import { describe, it, expect } from 'vitest';
import { domainOf, stripSourcesSection } from '@/lib/report/sources';

describe('stripSourcesSection', () => {
  it('removes a trailing Sources section and the whitespace before it', () => {
    const md = '# Title\n\nBody text [1].\n\n## Findings\n\nMore.\n\n## Sources\n\n1. [A](https://a.test)\n2. [B](https://b.test)\n';
    expect(stripSourcesSection(md)).toBe('# Title\n\nBody text [1].\n\n## Findings\n\nMore.');
  });

  it('keeps the document when Sources is not the last section', () => {
    const md = '# T\n\n## Sources\n\n1. x\n\n## Appendix\n\nmore';
    expect(stripSourcesSection(md)).toBe(md);
  });

  it('leaves reports without a Sources heading, or with a longer heading, alone', () => {
    expect(stripSourcesSection('# T\n\nbody')).toBe('# T\n\nbody');
    const longer = '# T\n\n## Sources and methods\n\ntext';
    expect(stripSourcesSection(longer)).toBe(longer);
  });
});

describe('domainOf', () => {
  it('returns the hostname without www, and the input for unparsable urls', () => {
    expect(domainOf('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(domainOf('https://news.test/x')).toBe('news.test');
    expect(domainOf('not a url')).toBe('not a url');
  });
});
