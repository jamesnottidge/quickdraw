import { randomUUID } from 'node:crypto';
import { Channel } from '@/lib/async/channel';
import type { AppConfig } from '@/lib/config';
import type { EventBody, RunEvent } from '@/lib/events/schema';
import type { Identity } from '@/lib/identity';
import { releaseReservation, reserve, settle } from '@/lib/limits/budget';
import { claimQuota, releaseQuota } from '@/lib/limits/quota';
import { reapStaleRuns } from '@/lib/limits/reaper';
import { CostMeter } from '@/lib/models/cost';
import { runPipeline, type PipelineDeps } from '@/lib/pipeline/run';
import { PROMPTS_SNAPSHOT } from '@/lib/prompts';
import type { Db } from '@/lib/store/db';
import { insertEvent } from '@/lib/store/events';
import { addTurn, createConversation } from '@/lib/store/conversations';
import { createRun, finishRun } from '@/lib/store/runs';
import { upsertSession } from '@/lib/store/sessions';

export interface StartRunInput {
  db: Db;
  config: AppConfig;
  identity: Identity;
  prompt: string;
  /** Adds the run as the next turn of this conversation (the caller has checked it belongs to the visitor). */
  conversationId?: string;
  now?: Date;
  buildDeps: (x: { runId: string; signal: AbortSignal; meter: CostMeter }) => PipelineDeps;
}

export type StartRunResult =
  | { ok: false; status: 400 | 429; code: 'bad_prompt' | 'quota' | 'spend' | 'search'; message: string }
  | { ok: true; runId: string; conversationId: string; channel: Channel<RunEvent>; done: Promise<void> };

const TIME_LIMIT = 'The run hit its time limit before it could finish.';

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const { db, config, identity } = input;
  const now = input.now ?? new Date();
  const prompt = input.prompt.trim();
  if (prompt.length < 3 || prompt.length > 2000) {
    return { ok: false, status: 400, code: 'bad_prompt', message: 'Enter a research request between 3 and 2000 characters.' };
  }

  try {
    await reapStaleRuns(db, config, now);
  } catch (e) {
    console.error('reapStaleRuns failed', e);
  }

  const sessionId = await upsertSession(db, identity);
  const quota = await claimQuota(db, config, identity, now);
  if (!quota.ok) {
    const where = quota.reason === 'device' ? 'this device' : 'this network';
    return {
      ok: false,
      status: 429,
      code: 'quota',
      message: `You've used today's ${quota.limit} runs for ${where}. Try again tomorrow (the day resets at 00:00 UTC).`,
    };
  }

  const reserved = await reserve(db, config, now);
  if (!reserved.ok) {
    await releaseQuota(db, identity, now).catch(() => {});
    return {
      ok: false,
      status: 429,
      code: reserved.reason,
      message:
        reserved.reason === 'spend'
          ? "This demo's daily budget has been used up. Please come back tomorrow."
          : "This demo's daily search budget has been used up. Please come back tomorrow.",
    };
  }

  const runId = randomUUID();
  try {
    await createRun(db, {
      id: runId,
      sessionId,
      prompt,
      config: { config, prompts: PROMPTS_SNAPSHOT, search: 'tavily' },
      reservedUsd: reserved.reservation.usd,
      reservedSearches: reserved.reservation.searches,
      ledgerDay: reserved.reservation.day,
      startedAt: now,
    });
  } catch (e) {
    await releaseReservation(db, reserved.reservation).catch(() => {});
    await releaseQuota(db, identity, now).catch(() => {});
    throw e;
  }

  let conversationId: string;
  try {
    conversationId = input.conversationId ?? (await createConversation(db, { sessionId, title: prompt }));
    await addTurn(db, { conversationId, kind: 'research', prompt, runId });
  } catch (e) {
    await finishRun(db, runId, { status: 'failed', costUsd: 0, error: 'Could not start the run.' }).catch(() => {});
    await settle(db, runId, { actualUsd: 0, searchesUsed: 0 }).catch(() => {});
    await releaseQuota(db, identity, now).catch(() => {});
    throw e;
  }

  const channel = new Channel<RunEvent>();
  const meter = new CostMeter();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.maxRunMs);

  const done = (async () => {
    let seq = 0;
    let searches = 0;
    const state: { terminal: EventBody | null } = { terminal: null };

    const emit = async (body: EventBody) => {
      const ev = { runId, seq: ++seq, ts: Date.now(), ...body } as RunEvent;
      if (ev.type === 'search_started') searches++;
      if (ev.type === 'run_finished' || ev.type === 'run_failed') state.terminal = body;
      try {
        await insertEvent(db, ev); // persist first, so a replay is never behind the live stream
      } catch (e) {
        console.error('event persist failed', e);
      }
      channel.push(ev);
    };

    try {
      const deps = input.buildDeps({ runId, signal: abort.signal, meter });
      for await (const body of runPipeline(prompt, deps)) await emit(body);
    } catch (e) {
      if (!state.terminal) {
        await emit({
          type: 'run_failed',
          message: abort.signal.aborted ? TIME_LIMIT : (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
      }
    } finally {
      clearTimeout(timer);
      if (!state.terminal) await emit({ type: 'run_failed', message: 'The run ended unexpectedly.' });
      const finished = state.terminal?.type === 'run_finished';
      try {
        await finishRun(db, runId, {
          status: finished ? 'finished' : 'failed',
          costUsd: meter.total(),
          error: state.terminal?.type === 'run_failed' ? state.terminal.message : undefined,
        });
      } catch (e) {
        console.error('finishRun failed', e);
      }
      try {
        await settle(db, runId, { actualUsd: meter.total(), searchesUsed: searches });
      } catch (e) {
        console.error('settle failed', e);
      }
      channel.close();
    }
  })();

  return { ok: true, runId, conversationId, channel, done };
}
