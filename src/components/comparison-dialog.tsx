'use client';

import { useEffect, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ComparisonResult } from '@/lib/comparison/types';
import { formatDuration, formatRatio, formatUsd } from '@/lib/ui/format';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: ComparisonResult }
  | { status: 'error'; message: string };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

export function ComparisonDialog({
  runId,
  open,
  onOpenChange,
}: {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!open || state.status === 'ready') return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/run/${runId}/comparison`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 409 ? 'This run has not finished yet.' : 'The comparison could not be computed.');
        return (await res.json()) as ComparisonResult;
      })
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((e: Error) => !cancelled && setState({ status: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto overflow-x-hidden sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Cost and speed comparison</DialogTitle>
          <DialogDescription>
            What this run would have cost, and how long it would have taken, if a single model had done every step.
          </DialogDescription>
        </DialogHeader>

        {state.status === 'loading' || state.status === 'idle' ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : state.status === 'error' ? (
          <Alert variant="destructive" role="alert"><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : (
          <Result data={state.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Result({ data }: { data: ComparisonResult }) {
  const { harness, alternatives } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Approach</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">vs harness</TableHead>
            <TableHead className="text-right">Time</TableHead>
            <TableHead className="hidden text-right sm:table-cell">vs harness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/50 font-medium">
            <TableCell className="whitespace-normal">
              {harness.label} <Badge className="ml-1 align-middle">Actual</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(harness.costUsd)}</TableCell>
            <TableCell className="hidden text-right text-muted-foreground sm:table-cell">1×</TableCell>
            <TableCell className="text-right tabular-nums">{formatDuration(harness.wallMs)}</TableCell>
            <TableCell className="hidden text-right text-muted-foreground sm:table-cell">1×</TableCell>
          </TableRow>
          {alternatives.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-normal">
                {a.label} <Badge variant="outline" className="ml-1 align-middle font-normal">Estimate</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsd(a.costUsd)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatRatio(a.costVsHarness)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {a.wallMs === null ? 'n/a' : formatDuration(a.wallMs)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatRatio(a.timeVsHarness)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      <ul className="flex flex-col gap-2 sm:hidden">
        <ModelCard label={harness.label} badge="Actual" cost={formatUsd(harness.costUsd)} time={formatDuration(harness.wallMs)} highlight />
        {alternatives.map((a) => (
          <ModelCard
            key={a.id}
            label={a.label}
            badge="Estimate"
            cost={formatUsd(a.costUsd)}
            costRatio={formatRatio(a.costVsHarness)}
            time={a.wallMs === null ? 'n/a' : formatDuration(a.wallMs)}
            timeRatio={a.wallMs === null ? undefined : formatRatio(a.timeVsHarness)}
          />
        ))}
      </ul>

      <Accordion type="multiple">
        <AccordionItem value="stages">
          <AccordionTrigger>Where this run&rsquo;s cost went</AccordionTrigger>
          <AccordionContent>
            <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Tokens in / out</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {harness.stages.map((s, i) => (
                  <TableRow key={`${s.stage}-${s.model}-${i}`}>
                    <TableCell>{s.stage.replace('_', ' ')}</TableCell>
                    <TableCell className="text-muted-foreground">{s.model.split('/').pop()}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.calls}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.inputTokens.toLocaleString()} / {s.outputTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(s.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <ul className="flex flex-col divide-y sm:hidden">
              {harness.stages.map((st, i) => (
                <li key={`${st.stage}-${st.model}-${i}`} className="flex flex-col gap-0.5 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium capitalize">{st.stage.replace('_', ' ')}</span>
                    <span className="tabular-nums">{formatUsd(st.costUsd)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {st.model.split('/').pop()} · {st.calls} {st.calls === 1 ? 'call' : 'calls'} · {st.inputTokens.toLocaleString()} in / {st.outputTokens.toLocaleString()} out
                  </span>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="method">
          <AccordionTrigger>How this is estimated</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {data.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="break-words text-xs text-muted-foreground">
        {data.pricesAsOf ? `Prices as of ${day(data.pricesAsOf)}` : 'Prices unavailable'}
        {' · '}
        {data.benchmarkedAt ? `speeds benchmarked ${day(data.benchmarkedAt)}` : 'speeds not benchmarked yet (time shows n/a)'}
      </p>
    </div>
  );
}

function ModelCard({
  label,
  badge,
  cost,
  costRatio,
  time,
  timeRatio,
  highlight,
}: {
  label: string;
  badge: 'Actual' | 'Estimate';
  cost: string;
  costRatio?: string;
  time: string;
  timeRatio?: string;
  highlight?: boolean;
}) {
  return (
    <li className={`rounded-xl border p-3 ${highlight ? 'bg-muted/50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{label}</span>
        <Badge variant={highlight ? 'default' : 'outline'} className="shrink-0 font-normal">{badge}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Cost</dt>
          <dd className="text-sm tabular-nums">{cost}{costRatio && <span className="ml-1.5 text-xs text-muted-foreground">{costRatio}</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Time</dt>
          <dd className="text-sm tabular-nums">{time}{timeRatio && <span className="ml-1.5 text-xs text-muted-foreground">{timeRatio}</span>}</dd>
        </div>
      </dl>
    </li>
  );
}
