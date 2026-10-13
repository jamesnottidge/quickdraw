'use client';

import type { RunView } from '@/lib/events/reducer';
import { ChatThread } from './ChatThread';
import { ReportCanvas } from './ReportCanvas';

export function RunScreen({ view }: { view: RunView }) {
  const hasReport = view.report.length > 0;
  return (
    <div className={`screen ${hasReport ? 'with-canvas' : ''}`}>
      <ChatThread view={view} />
      {hasReport && <ReportCanvas text={view.report} done={view.reportDone} />}
    </div>
  );
}
