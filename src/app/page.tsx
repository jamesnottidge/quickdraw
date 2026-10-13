'use client';

import { PrivacyNotice } from '@/components/PrivacyNotice';
import { PromptForm } from '@/components/PromptForm';
import { RunScreen } from '@/components/RunScreen';
import { useRunStream } from '@/hooks/useRunStream';

export default function Home() {
  const { view, rejected, starting, start, reset } = useRunStream();
  const active = view.status !== 'idle';
  return (
    <main className="app">
      <header className="masthead">
        <h1>CDM Research Agent</h1>
        <p className="muted">A general LLM plans and writes. Small task-specific models score, filter and summarize.</p>
      </header>
      {!active && <PromptForm onSubmit={start} disabled={starting} />}
      {rejected && (
        <p role="alert" className="error">
          {rejected}
        </p>
      )}
      {active && <RunScreen view={view} />}
      {active && view.status !== 'running' && (
        <button type="button" className="secondary" onClick={reset}>
          New research
        </button>
      )}
      <PrivacyNotice />
    </main>
  );
}
