import type { AppConfig } from '@/lib/config';
import { CHAT_SYSTEM } from '@/lib/prompts';
import { streamMuse, type MuseMessage } from './muse';
import type { ModelCtx } from './types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** A short reply from the planner model in the Quickdraw persona, for messages that are not research questions. */
export async function chatReply(
  ctx: ModelCtx,
  cfg: AppConfig,
  history: ChatTurn[],
  message: string,
): Promise<{ text: string; costUsd: number }> {
  const messages: MuseMessage[] = [
    { role: 'system', content: CHAT_SYSTEM },
    ...history,
    { role: 'user', content: message },
  ];
  let text = '';
  let costUsd = 0;
  for await (const ev of streamMuse(ctx, cfg.models.planner, 'chat', {
    messages,
    maxTokens: cfg.chat.maxTokens,
    reasoningEffort: 'minimal',
  })) {
    if (ev.type === 'text') text += ev.delta;
    if (ev.type === 'finish') costUsd = ev.costUsd;
  }
  text = text.trim();
  if (!text) throw new Error('The chat model returned an empty reply');
  return { text, costUsd };
}
