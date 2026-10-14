'use client';

import { Message, MessageContent, MessageStack } from './chat-message';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { CanvasController } from '@/hooks/useCanvas';
import type { TurnState } from '@/lib/ui/conversation';
import { ResearchTimeline } from './research-timeline';
import { RunActions } from './run-actions';

/** One visitor message and Quickdraw's answer: a research run, a short reply, or a notice. */
export function TurnView({
  turn,
  canvas,
  onCompare,
}: {
  turn: TurnState;
  canvas?: CanvasController;
  onCompare?: () => void;
}) {
  const view = turn.view;
  return (
    <>
      <Message from="user">
        <MessageStack>
          <MessageContent className="whitespace-pre-wrap">{turn.prompt}</MessageContent>
        </MessageStack>
      </Message>

      <Message from="assistant" className="max-w-full">
        <MessageStack>
          <MessageContent className="flex flex-col gap-4 px-0">
            {turn.kind === 'pending' && <p className="animate-pulse text-sm text-muted-foreground">Working on it…</p>}

            {(turn.kind === 'chat' || turn.kind === 'decline') && <p className="whitespace-pre-wrap px-2">{turn.reply}</p>}

            {turn.kind === 'research' && view && (
              <>
                <ResearchTimeline view={view} />

                {view.status === 'failed' && (
                  <Alert variant="destructive">
                    <AlertTitle>The run failed</AlertTitle>
                    <AlertDescription>{view.error}</AlertDescription>
                  </Alert>
                )}
                {view.status === 'interrupted' && (
                  <Alert>
                    <AlertTitle>Interrupted</AlertTitle>
                    <AlertDescription>
                      {view.error ?? 'The connection ended before the run finished.'} The run may still complete on the server;
                      reload this page in a minute to see it.
                    </AlertDescription>
                  </Alert>
                )}

                {view.tldr && (
                  <section className="rounded-xl border bg-muted/40 p-4" aria-label="TLDR">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">TLDR</p>
                    <p className="mt-1.5 text-sm leading-6">{view.tldr}</p>
                  </section>
                )}

                <RunActions view={view} canvas={canvas} onCompare={onCompare} />
              </>
            )}
            {turn.kind === 'research' && !view && (
              <Alert variant="destructive">
                <AlertDescription>This research could not be loaded.</AlertDescription>
              </Alert>
            )}
          </MessageContent>
        </MessageStack>
      </Message>
    </>
  );
}
