'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasController, CanvasTab } from '@/components/run-screen';
import type { RunView } from '@/lib/events/reducer';

/** Closed until the report is ready; a visitor who collapses it keeps it collapsed until they reopen it. */
export function useCanvas(view: RunView): CanvasController {
  const [open, setOpenState] = useState(false);
  const [tab, setTab] = useState<CanvasTab>('report');
  const dismissed = useRef(false);

  useEffect(() => {
    if (view.reportDone && !dismissed.current) setOpenState(true);
  }, [view.reportDone]);

  const setOpen = useCallback((value: boolean) => {
    if (!value) dismissed.current = true;
    setOpenState(value);
  }, []);

  return { open, setOpen, tab, setTab };
}
