import { describe, it, expect } from 'vitest';
import { fetchPage } from '@/lib/fetch/fetchPage';
import { FetchError, UnsafeUrlError } from '@/lib/fetch/errors';
import { loadConfig } from '@/lib/config';
import { makeFetch } from '../helpers/http';

const limits = loadConfig({}).fetch;
const deps = (handler: Parameters<typeof makeFetch>[0], over: Partial<typeof limits> = {}, maxChars = 200_000) => {
  const { fetchImpl, calls } = makeFetch(handler);
  return { d: { fetchImpl, limits: { ...limits, ...over }, maxChars }, calls };
};

const para = '<p>Section aware chunking keeps clauses and their cross references together, which improves retrieval accuracy for long contracts and statutes.</p>';
const articleHtml = `<html><head><title>T</title></head><body><article><h1>T</h1>${para.repeat(8)}</article></body></html>`;
const html = (body: string, status = 200, type = 'text/html; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': type } });

describe('fetchPage', () => {
  it('returns markdown for an HTML page', async () => {
    const { d } = deps(() => html(articleHtml));
    const page = await fetchPage('https://example.com/post', d);
    expect(page.kind).toBe('markdown');
    if (page.kind !== 'markdown') return;
    expect(page.title).toBe('T');
    expect(page.markdown).toContain('Section aware chunking');
    expect(page.contentType).toBe('text/html');
    expect(page.truncated).toBe(false);
  });

  it('REVIEW FOCUS: a login wall / near-empty page is a failure, not a document', async () => {
    const { d } = deps(() => html('<html><body><p>Please log in to continue</p></body></html>'));
    await expect(fetchPage('https://example.com/wall', d)).rejects.toThrow(/little content/i);
  });

  it('REVIEW FOCUS (final review): a link-heavy sign-in page is rejected on readable text, not markdown length', async () => {
    const nav = ['world/politics', 'business/markets', 'technology/ai', 'sport/football', 'culture/film', 'science/space']
      .map((p) => `<a href="https://news.example.com/${p}/section-front">${p.split('/')[0]}</a>`)
      .join('');
    const { d } = deps(() =>
      html(`<html><head><title>Sign in</title></head><body><nav>${nav}</nav><h1>Sign in to continue</h1><form><label>Email<input></label><button>Continue</button></form></body></html>`),
    );
    await expect(fetchPage('https://news.example.com/article', d)).rejects.toThrow(/little content/i);
  });

  it('follows redirects, re-checking every hop for SSRF', async () => {
    const { d, calls } = deps((url) =>
      url === 'https://example.com/a'
        ? new Response(null, { status: 302, headers: { location: '/b' } })
        : html(articleHtml),
    );
    const page = await fetchPage('https://example.com/a', d);
    expect(page.finalUrl).toBe('https://example.com/b');
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('blocks a redirect to a private address', async () => {
    const { d } = deps(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    await expect(fetchPage('https://example.com/a', d)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('stops after too many redirects', async () => {
    const { d } = deps(() => new Response(null, { status: 302, headers: { location: '/loop' } }));
    await expect(fetchPage('https://example.com/loop', d)).rejects.toThrow(/redirect/i);
  });

  it('rejects an unsafe starting URL without calling fetch', async () => {
    const { d, calls } = deps(() => html(articleHtml));
    await expect(fetchPage('http://localhost/', d)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toHaveLength(0);
  });

  it('fails on HTTP errors and unsupported content types', async () => {
    await expect(fetchPage('https://example.com/x', deps(() => html('nope', 404)).d)).rejects.toThrow(/404/);
    await expect(
      fetchPage('https://example.com/x', deps(() => html('PK', 200, 'application/zip')).d),
    ).rejects.toThrow(/unsupported content-type/i);
  });

  it('returns a data URL for PDFs and images', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-
    const { d } = deps(() => new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const page = await fetchPage('https://example.com/files/report.pdf', d);
    expect(page.kind).toBe('binary');
    if (page.kind !== 'binary') return;
    expect(page.dataUrl).toBe(`data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`);
    expect(page.filename).toBe('report.pdf');
    expect(page.mime).toBe('application/pdf');
  });

  it('rejects an oversized binary but only truncates oversized HTML', async () => {
    const big = new Uint8Array(5000);
    const bin = deps(() => new Response(big, { status: 200, headers: { 'content-type': 'image/png' } }), { maxBinaryBytes: 1000 });
    await expect(fetchPage('https://example.com/i.png', bin.d)).rejects.toThrow(/too large/i);

    const text = deps(() => html(articleHtml), { maxBytes: 600, minChars: 20 });
    const page = await fetchPage('https://example.com/long', text.d);
    expect(page.kind === 'markdown' && page.truncated).toBe(true);
  });

  it('caps markdown at maxChars', async () => {
    const { d } = deps(() => html(articleHtml), {}, 300);
    const page = await fetchPage('https://example.com/post', d);
    expect(page.kind === 'markdown' && page.markdown.length).toBeLessThanOrEqual(300);
  });

  it('REVIEW FOCUS: NUL bytes in a page never reach the result', async () => {
    const { d } = deps(() => html(articleHtml.replace('Section', 'Sec\u0000tion')));
    const page = await fetchPage('https://example.com/nul', d);
    expect(page.kind === 'markdown' && page.markdown.includes('\u0000')).toBe(false);
  });
});
