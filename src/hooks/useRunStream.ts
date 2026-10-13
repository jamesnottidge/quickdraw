'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { applyEvent, initialRunView, markStreamEnded, type RunView } from '@/lib/events/reducer';
import type { RunEvent } from '@/lib/events/schema';
import { consumeEventStream } from '@/lib/sse/consume';

type Action =
  | { kind: 'event'; ev: RunEvent }
  | { kind: 'events'; events: RunEvent[] }
  | { kind: 'ended' }
  | { kind: 'reset' };

function reducer(state: RunView, action: Action): RunView {
  switch (action.kind) {
    case 'event':
      return applyEvent(state, action.ev);
    case 'events':
      return action.events.reduce((s, e) => applyEvent(s, e), state);
    case 'ended':
      return markStreamEnded(state);
    case 'reset':
      return initialRunView;
  }
}

export function useRunStream() {
  const [view, dispatch] = useReducer(reducer, initialRunView);
  const [rejected, setRejected] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (prompt: string) => {
    setRejected(null);
    setRunId(null);
    setStarting(true);
    dispatch({ kind: 'reset' });
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setRejected(j?.message ?? 'The request failed. Please try again.');
        return;
      }
      const id = res.headers.get('x-run-id');
      setRunId(id);
      if (id) window.history.replaceState(null, '', `/run/${id}`);
      await consumeEventStream(res.body, (ev) => dispatch({ kind: 'event', ev }));
    } catch {
      /* a dropped connection is reported by markStreamEnded below, never as success */
    } finally {
      dispatch({ kind: 'ended' });
      setStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ kind: 'reset' });
    setRejected(null);
    setRunId(null);
    window.history.replaceState(null, '', '/');
  }, []);

  return { view, rejected, runId, starting, start, reset };
}

export function useReplay(runId: string) {
  const [view, dispatch] = useReducer(reducer, initialRunView);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;

    async function load() {
      try {
        // Only the first open counts as a reconnect; background polls pass ?poll=1.
        const res = await fetch(`/api/run/${runId}${first ? '' : '?poll=1'}`, { cache: 'no-store' });
        first = false;
        if (cancelled) return;
        if (res.status === 404) return setState('missing');
        if (!res.ok) throw new Error('bad status');
        const json = (await res.json()) as { events: RunEvent[]; active: boolean };
        if (cancelled) return;
        dispatch({ kind: 'reset' });
        dispatch({ kind: 'events', events: json.events });
        // A run that is no longer active but never reached a terminal event shows as interrupted.
        if (!json.active) dispatch({ kind: 'ended' });
        setState('ready');
        if (json.active) timer = setTimeout(load, 2000);
      } catch {
        if (!cancelled) setState('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  return { view, state };
}
