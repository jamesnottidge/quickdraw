'use client';

import { NewResearch } from '@/components/new-research';
import { RunScreen } from '@/components/run-screen';
import { useRunStream } from '@/hooks/useRunStream';

export default function Home() {
  const { view, rejected, runId, starting, start } = useRunStream();
  if (view.status !== 'idle') return <RunScreen key={runId ?? 'live'} view={view} runId={runId} />;
  return <NewResearch onSubmit={start} disabled={starting} error={rejected} />;
}
