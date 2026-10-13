'use client';

import type { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

export function SplitLayout({ left, right }: { left: ReactNode; right: ReactNode | null }) {
  if (!right) return <div className="h-full">{left}</div>;
  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel defaultSize="52%" minSize="30%">
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="48%" minSize="28%">
        {right}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
