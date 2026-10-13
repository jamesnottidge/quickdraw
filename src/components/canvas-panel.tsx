'use client';

import { PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RunView } from '@/lib/events/reducer';
import { ArtifactPane } from './artifact-pane';
import { ReportView } from './report-view';
import type { CanvasController, CanvasTab } from './run-screen';

function downloadHtml(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'research-interactive.html';
  a.click();
  URL.revokeObjectURL(url);
}

export function CanvasPanel({ view, canvas }: { view: RunView; canvas: CanvasController }) {
  const ready = view.artifact.status === 'ready' && !!view.artifact.html;
  return (
    <aside aria-label="Report canvas" className="flex h-full min-h-0 flex-col border-l bg-background">
      <Tabs value={canvas.tab} onValueChange={(t) => canvas.setTab(t as CanvasTab)} className="flex h-full min-h-0 flex-col gap-0">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
          <TabsList>
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="interactive">
              Interactive view
              {ready && canvas.tab !== 'interactive' && <span className="ml-1.5 size-1.5 rounded-full bg-emerald-500" aria-label="ready" />}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1">
            {canvas.tab === 'interactive' && ready && (
              <Button variant="ghost" size="sm" onClick={() => downloadHtml(view.artifact.html!)}>
                Download .html
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Collapse canvas" onClick={() => canvas.setOpen(false)}>
              <PanelRightClose className="size-4" />
            </Button>
          </div>
        </header>
        <TabsContent value="report" className="min-h-0 flex-1 overflow-y-auto">
          <ReportView view={view} />
        </TabsContent>
        <TabsContent value="interactive" className="min-h-0 flex-1">
          <ArtifactPane artifact={view.artifact} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
