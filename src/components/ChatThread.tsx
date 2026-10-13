import type { RunView } from '@/lib/events/reducer';
import { Timeline } from './Timeline';

export function ChatThread({ view }: { view: RunView }) {
  return (
    <section className="chat" aria-label="Research progress">
      <div className="bubble user">{view.prompt}</div>
      <div className="bubble assistant" aria-live="polite">
        <Timeline view={view} />
        {view.status === 'running' && <p className="muted">Working…</p>}
        {view.status === 'interrupted' && (
          <p role="alert" className="error">
            Interrupted: {view.error ?? 'the connection ended before the run finished.'} The run may still complete on
            the server; reload this page in a minute to see it.
          </p>
        )}
        {view.status === 'failed' && (
          <p role="alert" className="error">
            The run failed: {view.error}
          </p>
        )}
        {view.tldr && (
          <div className="tldr">
            <h3>TLDR</h3>
            <p>{view.tldr}</p>
          </div>
        )}
        {view.status === 'finished' && view.costUsd !== null && (
          <p className="muted">Done · model cost ${view.costUsd.toFixed(4)}</p>
        )}
      </div>
    </section>
  );
}
