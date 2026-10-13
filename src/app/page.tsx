'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { NewResearch } from '@/components/new-research';
import { RunScreen } from '@/components/run-screen';
import { useRunStream } from '@/hooks/useRunStream';

export default function Home() {
  const { view, rejected, runId, starting, start, reset } = useRunStream();
  const pathname = usePathname();

  // Starting a run swaps the URL to /run/<id> without remounting this page. When the visitor navigates back to
  // "/" (New research, the brand link) the page must drop the run it still holds and show the prompt again.
  useEffect(() => {
    if (pathname === '/' && view.status !== 'idle') reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (view.status !== 'idle') return <RunScreen key={runId ?? 'live'} view={view} runId={runId} />;
  return <NewResearch onSubmit={start} disabled={starting} error={rejected} />;
}
