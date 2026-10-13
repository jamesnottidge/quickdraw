'use client';

import { use } from 'react';
import Link from 'next/link';
import { PrivacyNotice } from '@/components/PrivacyNotice';
import { RunScreen } from '@/components/RunScreen';
import { useReplay } from '@/hooks/useRunStream';

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, state } = useReplay(id);
  return (
    <main className="app">
      <header className="masthead">
        <h1>
          <Link href="/">CDM Research Agent</Link>
        </h1>
      </header>
      {state === 'loading' && <p className="muted">Loading run…</p>}
      {state === 'missing' && <p role="alert" className="error">That run doesn&rsquo;t exist.</p>}
      {state === 'error' && <p role="alert" className="error">Couldn&rsquo;t load this run. Try reloading.</p>}
      {state === 'ready' && <RunScreen view={view} />}
      <PrivacyNotice />
    </main>
  );
}
