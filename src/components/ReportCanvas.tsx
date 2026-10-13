'use client';

import { useState } from 'react';
import { Markdown } from './Markdown';

export function ReportCanvas({ text, done }: { text: string; done: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'research-report.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="canvas" aria-label="Report">
      <header>
        <h2>Report</h2>
        <div className="canvas-actions">
          <button type="button" onClick={copy} disabled={!done}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={download} disabled={!done}>
            Download .md
          </button>
        </div>
      </header>
      <Markdown text={text} streaming={!done} />
    </aside>
  );
}
