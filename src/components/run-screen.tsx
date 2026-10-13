'use client';

import type { RunView } from '@/lib/events/reducer';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanvas } from '@/hooks/useCanvas';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CanvasPanel } from './canvas-panel';
import { RunThread } from './run-thread';
import { SplitLayout } from './split-layout';

export type CanvasTab = 'report' | 'interactive';

export interface CanvasController {
  open: boolean;
  setOpen(value: boolean): void;
  tab: CanvasTab;
  setTab(tab: CanvasTab): void;
}

export function RunScreen({ view }: { view: RunView; runId: string | null }) {
  const isMobile = useIsMobile();
  const canvas = useCanvas(view);
  const thread = <RunThread view={view} canvas={canvas} />;
  const panel = view.reportDone ? <CanvasPanel view={view} canvas={canvas} /> : null;

  if (isMobile) {
    return (
      <div className="h-full">
        {thread}
        <Sheet open={canvas.open && !!panel} onOpenChange={canvas.setOpen}>
          <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 data-[side=right]:sm:max-w-full">
            <SheetTitle className="sr-only">Report</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      </div>
    );
  }
  return <SplitLayout left={thread} right={canvas.open ? panel : null} />;
}
