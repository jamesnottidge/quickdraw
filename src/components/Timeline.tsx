import type { RunView } from '@/lib/events/reducer';

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function Timeline({ view }: { view: RunView }) {
  const queries = Object.keys(view.searches);
  const writing = view.report.length > 0;
  return (
    <ol className="timeline">
      <li>
        <h3>Planning</h3>
        {view.rounds.length === 0 && view.status === 'running' && <p className="muted">Thinking about what to search…</p>}
        {view.rounds.map((round) => (
          <div key={round.round} className="round">
            <p className="muted">
              Round {round.round}
              {round.drafting && ' · drafting queries…'}
            </p>
            <ul>
              {round.queries.map((q) => {
                const s = round.scores[q];
                return (
                  <li key={q}>
                    <span>{q}</span>
                    {s && (
                      <span className={`pill pill-${s.band}`} title={`confidence ${s.confidence.toFixed(2)}`}>
                        {s.band} · {s.score.toFixed(1)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {view.capHit && <p className="muted">Scoring limit reached; using the best queries so far.</p>}
        {view.submitted.length > 0 && <p className="muted">{view.submitted.length} queries chosen.</p>}
      </li>

      {queries.length > 0 && (
        <li>
          <h3>Searching</h3>
          <ul>
            {queries.map((q) => (
              <li key={q}>
                <span>{q}</span>
                <span className="muted">
                  {view.searches[q] === null ? 'searching…' : `${view.searches[q]!.length} results`}
                </span>
              </li>
            ))}
          </ul>
        </li>
      )}

      {view.pageOrder.length > 0 && (
        <li>
          <h3>Reading pages</h3>
          <ul>
            {view.pageOrder.map((url) => {
              const p = view.pages[url];
              return (
                <li key={url}>
                  <span title={url}>{p.title || host(url)}</span>
                  <span className={`pill pill-${p.status === 'failed' ? 'failed' : p.relevant === false ? 'skipped' : 'ok'}`}>
                    {p.status === 'failed'
                      ? p.reason
                      : p.status === 'fetched'
                        ? 'checking relevance…'
                        : p.relevant === false
                          ? `not relevant · ${(p.relevance ?? 0).toFixed(2)}`
                          : p.status === 'judged'
                            ? 'summarizing…'
                            : 'summarized'}
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      )}

      {(writing || view.status === 'finished') && (
        <li>
          <h3>Writing</h3>
          <p className="muted">{view.reportDone ? 'Report ready.' : 'Writing the report…'}</p>
        </li>
      )}
    </ol>
  );
}
