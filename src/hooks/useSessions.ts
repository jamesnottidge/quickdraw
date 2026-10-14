'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ConversationListItem } from '@/lib/store/conversations';

export type SessionItem = ConversationListItem;

/** Dispatch this on `window` to make the sidebar reload its list (run started / finished). */
export const SESSIONS_REFRESH = 'cdm:sessions-refresh';

export function useSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { cache: 'no-store' });
      if (res.ok) setSessions(((await res.json()) as { conversations: SessionItem[] }).conversations);
    } catch {
      /* keep the previous list */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener('focus', on);
    window.addEventListener(SESSIONS_REFRESH, on);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener(SESSIONS_REFRESH, on);
    };
  }, [refresh]);

  const anyRunning = sessions.some((s) => s.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  return { sessions, refresh };
}
