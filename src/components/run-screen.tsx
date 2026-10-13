'use client';

import type { RunView } from '@/lib/events/reducer';
import { RunThread } from './run-thread';

export type CanvasTab = 'report' | 'interactive';

export interface CanvasController {
  open: boolean;
  setOpen(value: boolean): void;
  tab: CanvasTab;
  setTab(tab: CanvasTab): void;
}

export function RunScreen({ view }: { view: RunView; runId: string | null }) {
  return (
    <div className="h-full">
      <RunThread view={view} />
    </div>
  );
}
