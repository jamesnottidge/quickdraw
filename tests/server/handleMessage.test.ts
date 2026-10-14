import { describe, it, expect, vi } from 'vitest';
import { handleMessage, approxTokens, type MessageDeps } from '@/lib/server/handleMessage';
import { createFakeDeps } from '@/lib/pipeline/fakes';
import { loadConfig } from '@/lib/config';
import { DECLINE_MESSAGE } from '@/lib/prompts';
import { getLedger, utcDay } from '@/lib/limits/budget';
import { listConversationsForDevice, listTurns } from '@/lib/store/conversations';
import type { Identity } from '@/lib/identity';
import { testDb } from '../helpers/db';

const identity: Identity = { deviceId: 'dev-A', ipHash: 'ip-A', userAgent: 'UA', isNewDevice: false };
const config = loadConfig({});

function deps(over: Partial<MessageDeps> = {}): MessageDeps & { chat: ReturnType<typeof vi.fn> } {
  return {
    classify: async (t: string) => !/^(hi|hello|thanks)/i.test(t) && !t.startsWith('NOT'),
    chat: vi.fn(async () => ({ text: 'I am Quickdraw.', costUsd: 0.0004 })),
    buildDeps: ({ signal, meter }: any) => createFakeDeps({ signal, meter }),
    ...over,
  } as any;
}

describe('handleMessage', () => {
  it('runs the research pipeline for a research question and records it as the first turn', async () => {
    const db = await testDb();
    const r = await handleMessage({ db, config, identity, message: 'legal rag chunking', deps: deps() });
    if (!r.ok || r.kind !== 'research') throw new Error('expected research');
    for await (const _ of r.channel) { /* drain */ }
    await r.done;
    const turns = await listTurns(db, r.conversationId);
    expect(turns).toMatchObject([{ seq: 1, kind: 'research', prompt: 'legal rag chunking', runId: r.runId }]);
  });

  it('answers a short non-research message with the chat model and keeps it in the conversation', async () => {
    const db = await testDb();
    const d = deps();
    const r = await handleMessage({ db, config, identity, message: 'hi there', deps: d });
    expect(r).toMatchObject({ ok: true, kind: 'chat', reply: 'I am Quickdraw.' });
    if (!r.ok || r.kind === 'research') throw new Error();
    expect(await listTurns(db, r.conversationId)).toMatchObject([{ kind: 'chat', prompt: 'hi there', reply: 'I am Quickdraw.' }]);
    expect(await listConversationsForDevice(db, 'dev-A')).toHaveLength(1);
    expect((await getLedger(db, utcDay(new Date())))!.actualUsd).toBeCloseTo(0.0004, 6);
  });

  it('declines a long non-research message without calling the chat model', async () => {
    const db = await testDb();
    const d = deps();
    const long = 'NOT research. ' + 'blah '.repeat(200);
    expect(approxTokens(long)).toBeGreaterThan(config.chat.maxInputTokens);
    const r = await handleMessage({ db, config, identity, message: long, deps: d });
    expect(r).toMatchObject({ ok: true, kind: 'decline', reply: DECLINE_MESSAGE });
    expect(d.chat).not.toHaveBeenCalled();
  });

  it('a long message that IS research still runs the pipeline', async () => {
    const db = await testDb();
    const long = 'research this: ' + 'chunking '.repeat(200);
    const r = await handleMessage({ db, config, identity, message: long, deps: deps() });
    expect(r).toMatchObject({ ok: true, kind: 'research' });
    if (r.ok && r.kind === 'research') { for await (const _ of r.channel) {} await r.done; }
  });

  it('appends later messages to the same conversation, and the chat model sees the history', async () => {
    const db = await testDb();
    const d = deps();
    const first = await handleMessage({ db, config, identity, message: 'hello', deps: d });
    if (!first.ok) throw new Error();
    await handleMessage({ db, config, identity, message: 'thanks a lot', conversationId: first.conversationId, deps: d });
    expect(d.chat.mock.calls[1][0]).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'I am Quickdraw.' },
    ]);
    expect((await listTurns(db, first.conversationId)).map((t) => t.seq)).toEqual([1, 2]);
  });

  it('adds a research run to an existing conversation after a chat turn', async () => {
    const db = await testDb();
    const first = await handleMessage({ db, config, identity, message: 'hello', deps: deps() });
    if (!first.ok) throw new Error();
    const r = await handleMessage({ db, config, identity, message: 'legal rag chunking', conversationId: first.conversationId, deps: deps() });
    if (!r.ok || r.kind !== 'research') throw new Error();
    for await (const _ of r.channel) {} await r.done;
    expect(r.conversationId).toBe(first.conversationId);
    expect((await listTurns(db, first.conversationId)).map((t) => t.kind)).toEqual(['chat', 'research']);
  });

  it('REVIEW FOCUS: another device cannot write into someone else\'s conversation', async () => {
    const db = await testDb();
    const first = await handleMessage({ db, config, identity, message: 'hello', deps: deps() });
    if (!first.ok) throw new Error();
    const r = await handleMessage({
      db, config, identity: { ...identity, deviceId: 'dev-B' }, message: 'hello', conversationId: first.conversationId, deps: deps(),
    });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it('treats a classifier failure as research, as before this feature existed', async () => {
    const db = await testDb();
    const r = await handleMessage({
      db, config, identity, message: 'legal rag chunking',
      deps: deps({ classify: async () => { throw new Error('down'); } }),
    });
    expect(r).toMatchObject({ ok: true, kind: 'research' });
    if (r.ok && r.kind === 'research') { for await (const _ of r.channel) {} await r.done; }
  });

  it('caps chat replies per device per day, but research is unaffected', async () => {
    const db = await testDb();
    const cfg = loadConfig({ CHATS_PER_DEVICE_PER_DAY: '2' });
    const d = deps();
    for (let i = 0; i < 2; i++) expect((await handleMessage({ db, config: cfg, identity, message: 'hello', deps: d })).ok).toBe(true);
    expect(await handleMessage({ db, config: cfg, identity, message: 'hello', deps: d })).toMatchObject({ ok: false, status: 429, code: 'quota' });
    const r = await handleMessage({ db, config: cfg, identity, message: 'legal rag chunking', deps: d });
    expect(r).toMatchObject({ ok: true, kind: 'research' });
    if (r.ok && r.kind === 'research') { for await (const _ of r.channel) {} await r.done; }
  });

  it('rejects empty and over-long messages', async () => {
    const db = await testDb();
    expect(await handleMessage({ db, config, identity, message: ' ', deps: deps() })).toMatchObject({ ok: false, status: 400 });
    expect(await handleMessage({ db, config, identity, message: 'x'.repeat(2001), deps: deps() })).toMatchObject({ ok: false, status: 400 });
  });
});
