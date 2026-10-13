'use client';

import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Citation, CitationContent, CitationItem, CitationTrigger } from '@/components/nexus-ui/citation';
import type { RunView, SourceView } from '@/lib/events/reducer';
import { remarkCitations } from '@/lib/report/citations';
import { stripSourcesSection } from '@/lib/report/sources';
import { SourcesList } from './sources-list';

function CitationChip({ n, sources }: { n: number; sources: SourceView[] }) {
  const source = sources.find((s) => s.n === n);
  if (!source) return <>[{n}]</>;
  return (
    <Citation citations={[{ url: source.url, title: source.title, description: source.snippet }]}>
      <CitationTrigger label={String(n)} showFavicon={false} className="mx-0.5 h-5 px-1.5 py-0 align-[0.15em]" />
      <CitationContent>
        <CitationItem />
      </CitationContent>
    </Citation>
  );
}

export function ReportView({ view }: { view: RunView }) {
  const { sources } = view;
  // The server appends a markdown "## Sources" list. With structured sources we render richer cards instead;
  // a run recorded before sources existed keeps the markdown list.
  const markdown = useMemo(() => (sources.length > 0 ? stripSourcesSection(view.report) : view.report), [view.report, sources.length]);

  const components = useMemo(
    () =>
      ({
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        ),
        img: () => null,
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto">
            <table>{children}</table>
          </div>
        ),
        'citation-ref': ({ n }: { n?: number | string }) => <CitationChip n={Number(n)} sources={sources} />,
      }) as Components,
    [sources],
  );

  return (
    <article className="mx-auto w-full max-w-[46rem] px-6 py-10 sm:px-10">
      <div className="prose prose-neutral max-w-none font-serif dark:prose-invert prose-headings:font-sans prose-headings:tracking-tight prose-h1:text-3xl prose-h1:leading-tight prose-p:text-[1.0625rem] prose-p:leading-8 prose-li:text-[1.0625rem] prose-li:leading-8 prose-a:text-foreground prose-a:underline-offset-4 prose-blockquote:font-normal prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none [&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0">
        <ReactMarkdown remarkPlugins={[remarkGfm, [remarkCitations, { max: sources.length }]]} skipHtml components={components}>
          {markdown}
        </ReactMarkdown>
      </div>
      {sources.length > 0 && <SourcesList sources={sources} />}
    </article>
  );
}
