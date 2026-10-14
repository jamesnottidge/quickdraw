'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Thread, ThreadContent, ThreadScrollToBottom } from '@/components/nexus-ui/thread';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanvas, type CanvasController } from '@/hooks/useCanvas';
import { initialRunView } from '@/lib/events/reducer';
import type { TurnState } from '@/lib/ui/conversation';
import { CanvasPanel } from './canvas-panel';
import { ComparisonDialog } from './comparison-dialog';
import { TurnView } from './run-thread';
import { SplitLayout } from './split-layout';

/**
 * The turns of a conversation with one shared canvas. The canvas shows the latest finished report, or the one
 * the visitor opened from an earlier turn. `footer` is the composer; without it the screen is read-only.
 */
export function ConversationScreen({ turns, footer }: { turns: TurnState[]; footer?: ReactNode }) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);

  const reports = useMemo(() => turns.filter((t) => t.runId && t.view?.reportDone), [turns]);
  const latestRunId = reports.at(-1)?.runId ?? null;
  const active = reports.find((t) => t.runId === selected) ?? reports.at(-1);

  // A newer report takes the canvas back from an older one the visitor had opened.
  useEffect(() => setSelected(null), [latestRunId]);

  const canvas = useCanvas(active?.view ?? initialRunView, active?.runId ?? null);
  const controllerFor = (runId: string | undefined): CanvasController => ({
    open: canvas.open && active?.runId === runId,
    setOpen: (value) => {
      if (value && runId) setSelected(runId);
      canvas.setOpen(value);
    },
    tab: canvas.tab,
    setTab: canvas.setTab,
  });

  const thread = (
    <div className="flex h-full min-h-0 flex-col">
      <Thread className="min-h-0 flex-1">
        <ThreadContent className="mx-auto w-full max-w-3xl items-stretch gap-6 px-4 py-8">
          {turns.map((t) => (
            <TurnView
              key={t.id}
              turn={t}
              canvas={controllerFor(t.runId)}
              onCompare={t.runId ? () => setCompareRunId(t.runId!) : undefined}
            />
          ))}
        </ThreadContent>
        <ThreadScrollToBottom />
      </Thread>
      {footer && (
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">{footer}</div>
        </div>
      )}
    </div>
  );

  const dialog = compareRunId ? (
    <ComparisonDialog key={compareRunId} runId={compareRunId} open onOpenChange={(open) => !open && setCompareRunId(null)} />
  ) : null;
  const panel = active?.view ? <CanvasPanel view={active.view} canvas={canvas} /> : null;

  if (isMobile) {
    return (
      <div className="h-full">
        {thread}
        <Sheet open={canvas.open && !!panel} onOpenChange={canvas.setOpen}>
          <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-full">
            <SheetTitle className="sr-only">Report</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
        {dialog}
      </div>
    );
  }
  return (
    <>
      <SplitLayout left={thread} right={panel} open={canvas.open && !!panel} onOpenChange={canvas.setOpen} />
      {dialog}
    </>
  );
}
