import type { SourceView } from '@/lib/events/reducer';
import { domainOf } from '@/lib/report/sources';

export function SourcesList({ sources }: { sources: SourceView[] }) {
  return (
    <section aria-label="Sources" className="mt-12 border-t pt-8 font-sans">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</h2>
      <ol className="grid gap-3 sm:grid-cols-2">
        {sources.map((s) => (
          <li key={s.n}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex h-full gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">{s.n}</span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium leading-5">{s.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{domainOf(s.url)}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
