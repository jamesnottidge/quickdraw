import { describe, it, expect } from 'vitest';
import { extractTldr, makeTldr, summarize } from '@/lib/models/scaledown-chat';
import { loadConfig } from '@/lib/config';
import { TLDR_INSTRUCTION } from '@/lib/prompts';
import { HttpError } from '@/lib/http/errors';
import { jsonResponse, testCtx } from '../helpers/http';

const cfg = loadConfig({});

const chat = (content: string) =>
  jsonResponse({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000036 },
  });

const extractBody = (entities: unknown[]) =>
  chat(JSON.stringify({ entities, structured_result: null, input_tokens: 100, ocr_text: null }));

describe('summarize', () => {
  it('sends the instruction as a system message and the text as the user message', async () => {
    const { ctx, calls, records } = testCtx(() => chat('A summary.'));
    const out = await summarize(ctx, cfg, { instruction: 'Be brief.', text: 'LONG PAGE' });
    expect(out).toEqual({ text: 'A summary.', costUsd: 0.000036 });
    expect(calls[0].url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(calls[0].body.model).toBe('scaledown/summarize');
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'LONG PAGE' },
    ]);
    expect(calls[0].body.stream).toBeUndefined();
    expect(records[0]).toMatchObject({ stage: 'summarize', inputTokens: 100, outputTokens: 20 });
  });

  it('sends images as image_url parts and PDFs as file parts', async () => {
    const img = testCtx(() => chat('ok'));
    await summarize(img.ctx, cfg, { instruction: 'i', binary: { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', filename: 'a.png' } });
    expect(img.calls[0].body.messages[1].content).toEqual([
      { type: 'text', text: 'Summarize the attached document.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    const pdf = testCtx(() => chat('ok'));
    await summarize(pdf.ctx, cfg, { instruction: 'i', binary: { mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,BBBB', filename: 'r.pdf' } });
    expect(pdf.calls[0].body.messages[1].content[1]).toEqual({
      type: 'file',
      file: { filename: 'r.pdf', file_data: 'data:application/pdf;base64,BBBB' },
    });
  });

  it('throws on empty content and on HTTP errors', async () => {
    await expect(summarize(testCtx(() => chat('  ')).ctx, cfg, { instruction: 'i', text: 't' })).rejects.toThrow(/empty/i);
    await expect(summarize(testCtx(() => jsonResponse({}, 500)).ctx, cfg, { instruction: 'i', text: 't' })).rejects.toBeInstanceOf(HttpError);
  });
});

describe('extractTldr', () => {
  it('passes a plain-string tldr entity via provider.options and returns the tldr entity text', async () => {
    const { ctx, calls } = testCtx(() =>
      extractBody([
        { text: 'Chunking by section improves legal RAG.', type: 'tldr', confidence: 0.001, start: 0, end: 5, context: '' },
      ]),
    );
    const out = await extractTldr(ctx, cfg, 'THE REPORT');
    expect(out.text).toBe('Chunking by section improves legal RAG.');
    expect(calls[0].body.model).toBe('scaledown/extract');
    expect(calls[0].body.provider).toEqual({ options: { scaledown: { entities: { tldr: TLDR_INSTRUCTION } } } });
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'THE REPORT' }]);
    expect(calls[0].body.response_format).toBeUndefined();
  });

  it('throws when no tldr entity comes back', async () => {
    const { ctx } = testCtx(() => extractBody([]));
    await expect(extractTldr(ctx, cfg, 'R')).rejects.toThrow(/tldr/i);
  });
});

describe('makeTldr', () => {
  it('falls back to summarize when extract fails', async () => {
    let call = 0;
    const { ctx, calls } = testCtx(() => (++call === 1 ? jsonResponse({}, 500) : chat('Fallback TLDR.')));
    const out = await makeTldr(ctx, cfg, 'R');
    expect(out.text).toBe('Fallback TLDR.');
    expect(calls.map((c) => c.body.model)).toEqual(['scaledown/extract', 'scaledown/summarize']);
  });

  it('uses only summarize when configured', async () => {
    const { ctx, calls } = testCtx(() => chat('One sentence.'));
    await makeTldr(ctx, loadConfig({ TLDR_MODEL: 'summarize' }), 'R');
    expect(calls.map((c) => c.body.model)).toEqual(['scaledown/summarize']);
    expect(calls[0].body.messages[0].content).toMatch(/one[- ]sentence/i);
  });
});
