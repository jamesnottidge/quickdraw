'use client';

import { useEffect, type ReactNode } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

/**
 * Both panels always exist and the canvas panel is collapsed rather than removed, so the thread (and any
 * timeline step the visitor opened) keeps its state when the canvas opens and closes.
 */
export function SplitLayout({
  left,
  right,
  open,
  onOpenChange,
}: {
  left: ReactNode;
  right: ReactNode | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const canvasPanel = usePanelRef();
  useEffect(() => {
    const panel = canvasPanel.current;
    if (!panel) return;
    if (open && panel.isCollapsed()) panel.expand();
    if (!open && !panel.isCollapsed()) panel.collapse();
  }, [open, canvasPanel]);

  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel id="thread" minSize="30%">
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle className={open ? undefined : 'hidden'} />
      <ResizablePanel
        id="canvas"
        panelRef={canvasPanel}
        collapsible
        collapsedSize={0}
        defaultSize={open ? '48%' : 0}
        minSize="28%"
        onResize={(size) => {
          if (size.asPercentage === 0 && open) onOpenChange(false);
        }}
      >
        {open ? right : null}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
