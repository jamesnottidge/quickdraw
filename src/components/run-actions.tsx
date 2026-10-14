'use client';

import { Check, Copy, Download, FileText, Scale } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RunView } from '@/lib/events/reducer';
import type { CanvasController } from '@/hooks/useCanvas';

export function RunActions({
  view,
  canvas,
  onCompare,
}: {
  view: RunView;
  canvas?: CanvasController;
  onCompare?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!view.reportDone) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(view.report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([view.report], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'research-report.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canvas && !canvas.open && (
        <Button size="sm" onClick={() => canvas.setOpen(true)}>
          <FileText className="size-4" /> Open report
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button size="sm" variant="outline" onClick={download}>
        <Download className="size-4" /> Download .md
      </Button>
      {view.status === 'finished' && onCompare && (
        <Button size="sm" variant="outline" onClick={onCompare}>
          <Scale className="size-4" /> Compare cost and speed
        </Button>
      )}
    </div>
  );
}
