import { describe, it, expect } from 'vitest';
import {
  addTurn,
  createConversation,
  getConversationForDevice,
  listConversationsForDevice,
  listTurns,
} from '@/lib/store/conversations';
import { seedRun, testDb } from '../helpers/db';

describe('conversations store', () => {
  it('numbers turns in order and lists them with their run status', async () => {
    const db = await testDb();
    const { sessionId, runId } = await seedRun(db, { deviceId: 'dev-A', status: 'running' });
    const id = await createConversation(db, { sessionId, title: 'First question' });
    await addTurn(db, { conversationId: id, kind: 'research', prompt: 'First question', runId });
    await addTurn(db, { conversationId: id, kind: 'chat', prompt: 'thanks', reply: 'Anytime.' });
    const turns = await listTurns(db, id);
    expect(turns.map((t) => [t.seq, t.kind, t.prompt, t.reply, t.runId, t.runStatus])).toEqual([
      [1, 'research', 'First question', null, runId, 'running'],
      [2, 'chat', 'thanks', 'Anytime.', null, null],
    ]);
  });

  it('only returns a conversation to the device that owns it', async () => {
    const db = await testDb();
    const { sessionId } = await seedRun(db, { deviceId: 'dev-A' });
    const id = await createConversation(db, { sessionId, title: 't' });
    expect(await getConversationForDevice(db, id, 'dev-A')).toMatchObject({ id, title: 't' });
    expect(await getConversationForDevice(db, id, 'dev-B')).toBeNull();
    expect(await getConversationForDevice(db, '00000000-0000-4000-8000-000000000000', 'dev-A')).toBeNull();
  });

  it('lists a device\'s conversations, most recently active first, across IPs', async () => {
    const db = await testDb();
    const a = await seedRun(db, { deviceId: 'dev-A', ipHash: 'x' });
    const b = await seedRun(db, { deviceId: 'dev-A', ipHash: 'y' });
    const other = await seedRun(db, { deviceId: 'dev-B' });
    const c1 = await createConversation(db, { sessionId: a.sessionId, title: 'one' });
    const c2 = await createConversation(db, { sessionId: b.sessionId, title: 'two' });
    await createConversation(db, { sessionId: other.sessionId, title: 'not mine' });
    await addTurn(db, { conversationId: c1, kind: 'chat', prompt: 'hi', reply: 'hello' }); // c1 is touched last
    const list = await listConversationsForDevice(db, 'dev-A');
    expect(list.map((c) => c.id)).toEqual([c1, c2]);
    expect(list[0]).toMatchObject({ title: 'one', status: 'finished' });
  });

  it('reports running while any of its runs is running', async () => {
    const db = await testDb();
    const { sessionId, runId } = await seedRun(db, { deviceId: 'dev-A', status: 'running' });
    const id = await createConversation(db, { sessionId, title: 't' });
    await addTurn(db, { conversationId: id, kind: 'research', prompt: 'q', runId });
    expect((await listConversationsForDevice(db, 'dev-A'))[0].status).toBe('running');
  });

  it('the migration turns runs that predate conversations into one-turn conversations', async () => {
    const db = await testDb(); // migrations already ran on an empty db, so insert a legacy run and replay the backfill
    const { runId } = await seedRun(db, { deviceId: 'dev-A' });
    const fs = await import('node:fs');
    await db.exec(fs.readFileSync('db/migrations/003_conversations.sql', 'utf8'));
    const list = await listConversationsForDevice(db, 'dev-A');
    expect(list).toHaveLength(1);
    expect((await listTurns(db, list[0].id))[0]).toMatchObject({ kind: 'research', runId });
  });
});
