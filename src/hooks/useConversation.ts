'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, initialRunView, markStreamEnded, type RunView } from '@/lib/events/reducer';
import type { RunEvent } from '@/lib/events/schema';
import { consumeEventStream } from '@/lib/sse/consume';
import type { TurnState } from '@/lib/ui/conversation';
import { SESSIONS_REFRESH } from './useSessions';

interface ServerTurn {
  id: string;
  kind: 'research' | 'chat' | 'decline';
  prompt: string;
  reply: string | null;
  runId: string | null;
}

function viewOf(events: RunEvent[], active: boolean): RunView {
  const view = events.reduce(applyEvent, initialRunView);
  return active ? view : markStreamEnded(view);
}

async function fetchRunView(runId: string, first: boolean): Promise<RunView | null> {
  try {
    const res = await fetch(`/api/run/${runId}${first ? '' : '?poll=1'}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { events: RunEvent[]; active: boolean };
    return viewOf(json.events, json.active);
  } catch {
    return null;
  }
}

export type ConversationLoad = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

/** A conversation: its turns, loaded from the server or built up live as the visitor sends messages. */
export function useConversation(initialId?: string) {
  const [turns, setTurns] = useState<TurnState[]>([]);
  const [load, setLoad] = useState<ConversationLoad>(initialId ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const idRef = useRef<string | null>(initialId ?? null);
  const abortRef = useRef<AbortController | null>(null);
  const liveRuns = useRef(new Set<string>());
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const pathname = usePathname();

  const patch = useCallback((id: string, fn: (t: TurnState) => TurnState) => {
    setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  // Open a saved conversation.
  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${initialId}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) return setLoad('missing');
        if (!res.ok) return setLoad('error');
        const { turns: saved } = (await res.json()) as { turns: ServerTurn[] };
        const loaded = await Promise.all(
          saved.map(async (t): Promise<TurnState> => {
            if (t.kind !== 'research' || !t.runId) return { id: t.id, kind: t.kind, prompt: t.prompt, reply: t.reply ?? undefined };
            const view = (await fetchRunView(t.runId, true)) ?? undefined;
            return { id: t.id, kind: 'research', prompt: t.prompt, runId: t.runId, view };
          }),
        );
        if (cancelled) return;
        setTurns(loaded);
        setLoad('ready');
      } catch {
        if (!cancelled) setLoad('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  // A saved run that is still going (reloaded mid-run) is followed by polling until it ends.
  const following = turns.some((t) => t.view?.status === 'running' && t.runId && !liveRuns.current.has(t.runId));
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(async () => {
      for (const t of turnsRef.current) {
        if (t.view?.status !== 'running' || !t.runId || liveRuns.current.has(t.runId)) continue;
        const view = await fetchRunView(t.runId, false);
        if (view) patch(t.id, (x) => ({ ...x, view }));
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [following, patch]);

  // Leaving the page stops listening; a run itself carries on (and finishes) on the server.
  useEffect(() => () => abortRef.current?.abort(), []);

  const adopt = useCallback((conversationId: string | null) => {
    if (!conversationId || idRef.current) return;
    idRef.current = conversationId;
    window.history.replaceState(null, '', `/c/${conversationId}`);
  }, []);

  /** Sends one message. Resolves true when it was accepted, so the composer knows whether to clear. */
  const send = useCallback(
    async (message: string): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const tempId = crypto.randomUUID();
      let runId: string | null = null;
      setError(null);
      setSending(true);
      setTurns((all) => [...all, { id: tempId, kind: 'pending', prompt: message }]);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, conversationId: idRef.current ?? undefined }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setTurns((all) => all.filter((t) => t.id !== tempId));
          setError(j?.message ?? 'The request failed. Please try again.');
          return false;
        }
        adopt(res.headers.get('x-conversation-id') ?? null);
        if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
          runId = res.headers.get('x-run-id');
          if (runId) liveRuns.current.add(runId);
          window.dispatchEvent(new Event(SESSIONS_REFRESH));
          patch(tempId, (t) => ({ ...t, kind: 'research', runId: runId ?? undefined, view: initialRunView }));
          await consumeEventStream(res.body, (ev) => patch(tempId, (t) => ({ ...t, view: applyEvent(t.view ?? initialRunView, ev) })));
        } else {
          const j = (await res.json()) as { kind: 'chat' | 'decline'; conversationId: string; turnId: string; reply: string };
          adopt(j.conversationId);
          patch(tempId, (t) => ({ ...t, id: j.turnId, kind: j.kind, reply: j.reply }));
        }
        return true;
      } catch {
        // A dropped connection is reported by markStreamEnded below, never as success.
        if (!runId) {
          setTurns((all) => all.filter((t) => t.id !== tempId));
          if (!controller.signal.aborted) setError('The request failed. Please try again.');
          return false;
        }
        return true;
      } finally {
        if (runId) {
          liveRuns.current.delete(runId);
          patch(tempId, (t) => (t.view ? { ...t, view: markStreamEnded(t.view) } : t));
        }
        setSending(false);
        window.dispatchEvent(new Event(SESSIONS_REFRESH));
      }
    },
    [adopt, patch],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    liveRuns.current.clear();
    idRef.current = null;
    setTurns([]);
    setError(null);
    setSending(false);
    window.history.replaceState(null, '', '/');
  }, []);

  // Starting a conversation swaps the URL to /c/<id> without remounting the home page. When the visitor navigates
  // back to "/" (New research, the brand link) the page must drop the conversation it still holds.
  useEffect(() => {
    if (!initialId && pathname === '/' && idRef.current) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return { turns, load, error, sending, send };
}
