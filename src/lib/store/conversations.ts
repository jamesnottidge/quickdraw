import type { Db } from './db';
import { cleanText } from './util';

export type TurnKind = 'research' | 'chat' | 'decline';
export type RunStatus = 'running' | 'finished' | 'failed';

export interface TurnRow {
  id: string;
  seq: number;
  kind: TurnKind;
  prompt: string;
  reply: string | null;
  runId: string | null;
  runStatus: RunStatus | null;
}

export interface ConversationListItem {
  id: string;
  title: string;
  status: RunStatus;
  updatedAt: string;
}

export async function createConversation(db: Db, c: { sessionId: string; title: string }): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into conversations(session_id, title) values ($1, $2) returning id`,
    [c.sessionId, cleanText(c.title).slice(0, 80)],
  );
  return rows[0].id;
}

export async function addTurn(
  db: Db,
  t: { conversationId: string; kind: TurnKind; prompt: string; reply?: string; runId?: string },
): Promise<{ id: string; seq: number }> {
  const rows = await db.query<{ id: string; seq: number }>(
    `insert into turns(conversation_id, seq, kind, prompt, reply, run_id)
     values ($1, (select coalesce(max(seq), 0) + 1 from turns where conversation_id = $1), $2, $3, $4, $5)
     returning id, seq`,
    [t.conversationId, t.kind, cleanText(t.prompt), t.reply ? cleanText(t.reply) : null, t.runId ?? null],
  );
  await db.query(`update conversations set updated_at = now() where id = $1`, [t.conversationId]);
  return rows[0];
}

/** The conversation, but only for the device that owns it (any IP). */
export async function getConversationForDevice(
  db: Db,
  id: string,
  deviceId: string,
): Promise<{ id: string; title: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const rows = await db.query<{ id: string; title: string }>(
    `select c.id, c.title from conversations c join sessions s on s.id = c.session_id
      where c.id = $1 and s.device_id = $2`,
    [id, deviceId],
  );
  return rows[0] ?? null;
}

export async function listTurns(db: Db, conversationId: string): Promise<TurnRow[]> {
  const rows = await db.query<{
    id: string; seq: number; kind: TurnKind; prompt: string; reply: string | null; run_id: string | null; status: RunStatus | null;
  }>(
    `select t.id, t.seq, t.kind, t.prompt, t.reply, t.run_id, r.status
       from turns t left join runs r on r.id = t.run_id
      where t.conversation_id = $1 order by t.seq`,
    [conversationId],
  );
  return rows.map((r) => ({
    id: r.id, seq: r.seq, kind: r.kind, prompt: r.prompt, reply: r.reply, runId: r.run_id, runStatus: r.status,
  }));
}

/** A device's conversations, most recently active first. "running" while any of its runs is running. */
export async function listConversationsForDevice(db: Db, deviceId: string, limit = 50): Promise<ConversationListItem[]> {
  const rows = await db.query<{ id: string; title: string; updated_at: Date | string; running: boolean; failed: boolean }>(
    `select c.id, c.title, c.updated_at,
            exists (select 1 from turns t join runs r on r.id = t.run_id where t.conversation_id = c.id and r.status = 'running') as running,
            coalesce((select r.status = 'failed' from turns t join runs r on r.id = t.run_id
                       where t.conversation_id = c.id order by t.seq desc limit 1), false) as failed
       from conversations c join sessions s on s.id = c.session_id
      where s.device_id = $1
      order by c.updated_at desc
      limit $2`,
    [deviceId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.running ? 'running' : r.failed ? 'failed' : 'finished',
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
