import type { AppConfig } from '@/lib/config';
import type { Identity } from '@/lib/identity';
import { addActualSpend } from '@/lib/limits/budget';
import { claimChat } from '@/lib/limits/quota';
import type { ChatTurn } from '@/lib/models/chat';
import { DECLINE_MESSAGE } from '@/lib/prompts';
import type { Db } from '@/lib/store/db';
import { addTurn, createConversation, getConversationForDevice, listTurns } from '@/lib/store/conversations';
import { upsertSession } from '@/lib/store/sessions';
import { startRun, type StartRunInput, type StartRunResult } from './startRun';

export interface MessageDeps {
  /** true when the message is a research question. */
  classify: (text: string) => Promise<boolean>;
  chat: (history: ChatTurn[], text: string) => Promise<{ text: string; costUsd: number }>;
  buildDeps: StartRunInput['buildDeps'];
}

export type MessageResult =
  | { ok: false; status: 400 | 404 | 429; code: string; message: string }
  | Extract<StartRunResult, { ok: true }> & { kind: 'research' }
  | { ok: true; kind: 'chat' | 'decline'; conversationId: string; turnId: string; reply: string };

/** Roughly four characters per token: close enough to gate a cheap-vs-decline decision. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);

const RESEARCH_STUB = 'I did a round of research on that earlier in this conversation.';

/** Routes one visitor message: research pipeline, a short chat reply, or a polite decline for long off-topic text. */
export async function handleMessage(input: {
  db: Db;
  config: AppConfig;
  identity: Identity;
  message: string;
  conversationId?: string;
  deps: MessageDeps;
  now?: Date;
}): Promise<MessageResult> {
  const { db, config, identity, deps } = input;
  const now = input.now ?? new Date();
  const message = input.message.trim();
  if (message.length < 3 || message.length > 2000) {
    return { ok: false, status: 400, code: 'bad_prompt', message: 'Enter a message between 3 and 2000 characters.' };
  }

  if (input.conversationId && !(await getConversationForDevice(db, input.conversationId, identity.deviceId))) {
    return { ok: false, status: 404, code: 'not_found', message: 'That conversation does not exist.' };
  }

  // If the classifier is down, behave like before this feature existed: treat the message as research.
  let research = true;
  try {
    research = await deps.classify(message);
  } catch (e) {
    console.error('intent classification failed; treating as research', e);
  }

  if (research) {
    const started = await startRun({
      db, config, identity, prompt: message, conversationId: input.conversationId, now, buildDeps: deps.buildDeps,
    });
    return started.ok ? { ...started, kind: 'research' } : started;
  }

  const sessionId = await upsertSession(db, identity);
  const conversationId = input.conversationId ?? (await createConversation(db, { sessionId, title: message }));

  if (approxTokens(message) > config.chat.maxInputTokens) {
    const turn = await addTurn(db, { conversationId, kind: 'decline', prompt: message, reply: DECLINE_MESSAGE });
    return { ok: true, kind: 'decline', conversationId, turnId: turn.id, reply: DECLINE_MESSAGE };
  }

  if (!(await claimChat(db, config, identity, now))) {
    return {
      ok: false, status: 429, code: 'quota',
      message: `You've used today's ${config.limits.chatsPerDevicePerDay} chat replies on this device. Research questions still work, and the day resets at 00:00 UTC.`,
    };
  }

  const history = await historyFor(db, conversationId, config.chat.historyTurns);
  const reply = await deps.chat(history, message);
  await addActualSpend(db, reply.costUsd, now).catch((e) => console.error('chat spend not recorded', e));
  const turn = await addTurn(db, { conversationId, kind: 'chat', prompt: message, reply: reply.text });
  return { ok: true, kind: 'chat', conversationId, turnId: turn.id, reply: reply.text };
}

async function historyFor(db: Db, conversationId: string, maxTurns: number): Promise<ChatTurn[]> {
  const turns = (await listTurns(db, conversationId)).slice(-maxTurns);
  return turns.flatMap<ChatTurn>((t) => [
    { role: 'user', content: t.prompt },
    { role: 'assistant', content: t.kind === 'research' ? RESEARCH_STUB : (t.reply ?? '') },
  ]);
}
