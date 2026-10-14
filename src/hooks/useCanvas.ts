'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunView } from '@/lib/events/reducer';

export type CanvasTab = 'report' | 'interactive';

export interface CanvasController {
  open: boolean;
  setOpen(value: boolean): void;
  tab: CanvasTab;
  setTab(tab: CanvasTab): void;
}

/**
 * Closed until the report is ready; a visitor who collapses it keeps it collapsed until they reopen it.
 * `key` identifies the report on show: a different report arriving re-arms the automatic opening.
 */
export function useCanvas(view: RunView, key: string | null = null): CanvasController {
  const [open, setOpenState] = useState(false);
  const [tab, setTab] = useState<CanvasTab>('report');
  const dismissed = useRef(false);
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      dismissed.current = false;
    }
    if (view.reportDone && !dismissed.current) setOpenState(true);
  }, [view.reportDone, key]);

  const setOpen = useCallback((value: boolean) => {
    if (!value) dismissed.current = true;
    setOpenState(value);
  }, []);

  return { open, setOpen, tab, setTab };
}
