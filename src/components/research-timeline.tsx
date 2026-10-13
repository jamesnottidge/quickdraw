'use client';

import { BookOpen, ListChecks, PenLine, Search, Sparkles } from 'lucide-react';
import {
  ChainOfThought,
  ChainOfThoughtComplete,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtStepContent,
  ChainOfThoughtStepTitle,
  ChainOfThoughtTrigger,
} from '@/components/nexus-ui/chain-of-thought';
import { TextShimmer } from '@/components/nexus-ui/text-shimmer';
import { Badge } from '@/components/ui/badge';
import type { RunView } from '@/lib/events/reducer';
import { domainOf } from '@/lib/report/sources';
import { deriveSteps, type Step, type StepKey } from '@/lib/ui/steps';
import { cn } from '@/lib/utils';

const ICONS: Record<StepKey, typeof Search> = {
  plan: ListChecks,
  search: Search,
  read: BookOpen,
  write: PenLine,
  interactive: Sparkles,
};

const BAND_CLASS: Record<string, string> = {
  vague: 'text-amber-600 dark:text-amber-400',
  focused: 'text-muted-foreground',
  precise: 'text-emerald-600 dark:text-emerald-400',
};

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, Math.min(100, (score / 3) * 100))}%` }} />
    </span>
  );
}

function PlanDetail({ view }: { view: RunView }) {
  if (!view.rounds.length) return <p className="text-sm text-muted-foreground">Thinking about what to search for…</p>;
  return (
    <div className="flex flex-col gap-3">
      {view.rounds.map((round) => (
        <div key={round.round} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Round {round.round}
            {round.drafting && ' · drafting…'}
          </p>
          <ul className="flex flex-col gap-1.5">
            {round.queries.map((q) => {
              const s = round.scores[q];
              return (
                <li key={q} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={q}>{q}</span>
                  {s && (
                    <>
                      <ScoreBar score={s.score} />
                      <span className={cn('w-20 shrink-0 text-right text-xs', BAND_CLASS[s.band])} title={`confidence ${s.confidence.toFixed(2)}`}>
                        {s.band} · {s.score.toFixed(1)}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {view.capHit && <p className="text-xs text-muted-foreground">Scoring limit reached; using the best queries so far.</p>}
    </div>
  );
}

function SearchDetail({ view }: { view: RunView }) {
  const queries = Object.keys(view.searches);
  if (!queries.length) return <p className="text-sm text-muted-foreground">Waiting for queries…</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {queries.map((q) => (
        <li key={q} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate" title={q}>{q}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {view.searches[q] === null ? 'searching…' : `${view.searches[q]!.length} results`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReadDetail({ view }: { view: RunView }) {
  if (!view.pageOrder.length) return <p className="text-sm text-muted-foreground">Waiting for search results…</p>;
  return (
    <ul className="flex flex-col gap-3">
      {view.pageOrder.map((url) => {
        const p = view.pages[url];
        const state =
          p.status === 'failed' ? { text: p.reason ?? 'failed', cls: 'text-red-600 dark:text-red-400' }
          : p.status === 'fetched' ? { text: 'checking relevance…', cls: 'text-muted-foreground' }
          : p.relevant === false ? { text: `not relevant · ${(p.relevance ?? 0).toFixed(2)}`, cls: 'text-muted-foreground' }
          : p.status === 'judged' ? { text: 'summarizing…', cls: 'text-muted-foreground' }
          : { text: `relevant · ${(p.relevance ?? 1).toFixed(2)}`, cls: 'text-emerald-600 dark:text-emerald-400' };
        return (
          <li key={url} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm" title={url}>
                {p.title || domainOf(url)} <span className="text-xs text-muted-foreground">{domainOf(url)}</span>
              </span>
              <span className={cn('shrink-0 text-xs', state.cls)}>{state.text}</span>
            </div>
            {p.summary && <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{p.summary}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function StepDetail({ step, view }: { step: Step; view: RunView }) {
  switch (step.key) {
    case 'plan': return <PlanDetail view={view} />;
    case 'search': return <SearchDetail view={view} />;
    case 'read': return <ReadDetail view={view} />;
    case 'write':
      return <p className="text-sm text-muted-foreground">{view.reportDone ? 'The report is ready.' : 'Writing the report from the summaries…'}</p>;
    case 'interactive':
      return (
        <p className="text-sm text-muted-foreground">
          {view.artifact.status === 'ready' ? 'The interactive view is ready.'
            : view.artifact.status === 'building' ? 'Building a self-contained interactive page from the report…'
            : view.artifact.status === 'failed' ? `Not available: ${view.artifact.reason}`
            : 'Starts after the report is written.'}
        </p>
      );
  }
}

export function ResearchTimeline({ view }: { view: RunView }) {
  const steps = deriveSteps(view);
  const running = view.status === 'running';
  const label = running ? 'Researching' : view.status === 'finished' ? 'Research complete' : view.status === 'idle' ? 'Research' : 'Research stopped';
  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtTrigger>
        {running ? <TextShimmer as="span">Researching…</TextShimmer> : <span>{label}</span>}
      </ChainOfThoughtTrigger>
      <ChainOfThoughtContent>
        {steps.map((step) => {
          const Icon = ICONS[step.key];
          return (
            <ChainOfThoughtStep key={step.key} status={step.status} hasContent>
              <ChainOfThoughtStepTitle icon={<Icon className="size-4" />}>
                <span>{step.label}</span>
                <Badge variant="secondary" className="ml-2 font-normal">{step.summary}</Badge>
              </ChainOfThoughtStepTitle>
              <ChainOfThoughtStepContent>
                <StepDetail step={step} view={view} />
              </ChainOfThoughtStepContent>
            </ChainOfThoughtStep>
          );
        })}
        {view.status === 'finished' && <ChainOfThoughtComplete label="Research complete" />}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
