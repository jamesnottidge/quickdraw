import { describe, it, expect } from 'vitest';
import { getConversationList } from '@/lib/server/conversationList';
import { addTurn, createConversation } from '@/lib/store/conversations';
import { loadConfig } from '@/lib/config';
import { seedRun, testDb } from '../helpers/db';

const config = loadConfig({});
const now = new Date('2026-10-13T12:00:00Z');

describe('getConversationList', () => {
  it('REVIEW FOCUS: no device id, or a device with no conversations, yields an empty list (never someone else\'s)', async () => {
    const db = await testDb();
    const { sessionId } = await seedRun(db, { deviceId: 'dev-A' });
    await createConversation(db, { sessionId, title: 'mine' });
    expect(await getConversationList(db, config, undefined, now)).toEqual([]);
    expect(await getConversationList(db, config, 'dev-unknown', now)).toEqual([]);
  });

  it('reaps stale running runs so a conversation does not show as running forever', async () => {
    const db = await testDb();
    const stale = await seedRun(db, { deviceId: 'dev-A', status: 'running', startedAt: new Date(now.getTime() - 15 * 60_000) });
    const id = await createConversation(db, { sessionId: stale.sessionId, title: 'stuck' });
    await addTurn(db, { conversationId: id, kind: 'research', prompt: 'p', runId: stale.runId });
    const list = await getConversationList(db, config, 'dev-A', now);
    expect(list[0]).toMatchObject({ id, status: 'failed' });
  });

  it('limits the list to 50 conversations', async () => {
    const db = await testDb();
    const { sessionId } = await seedRun(db, { deviceId: 'dev-A' });
    for (let i = 0; i < 55; i++) await createConversation(db, { sessionId, title: `c${i}` });
    expect(await getConversationList(db, config, 'dev-A', now)).toHaveLength(50);
  });
});
