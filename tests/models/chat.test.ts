import { describe, it, expect } from 'vitest';
import { chatReply } from '@/lib/models/chat';
import { loadConfig } from '@/lib/config';
import { CHAT_SYSTEM } from '@/lib/prompts';
import { sseResponse, testCtx } from '../helpers/http';

const cfg = loadConfig({});
const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;
const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, cost: 0.0003 } })}\n\n`;

describe('chatReply', () => {
  it('sends the Quickdraw persona, the history and the message to the planner model, and returns text and cost', async () => {
    const { ctx, calls, records } = testCtx(() => sseResponse([chunk({ content: 'I am ' }), chunk({ content: 'Quickdraw.' }, 'stop'), usage, 'data: [DONE]\n\n']));
    const out = await chatReply(ctx, cfg, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'what are you?');
    expect(out).toEqual({ text: 'I am Quickdraw.', costUsd: 0.0003 });
    expect(calls[0].body.model).toBe('meta/muse-spark-1.3-contributor');
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: CHAT_SYSTEM },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what are you?' },
    ]);
    expect(calls[0].body.tools).toBeUndefined();
    expect(records[0].stage).toBe('chat');
    expect(CHAT_SYSTEM).toContain('Quickdraw, a fast and efficient research agent');
  });

  it('throws on an empty reply so the caller can fail visibly', async () => {
    const { ctx } = testCtx(() => sseResponse([chunk({ content: '  ' }, 'stop'), usage, 'data: [DONE]\n\n']));
    await expect(chatReply(ctx, cfg, [], 'hi')).rejects.toThrow(/empty/);
  });
});
