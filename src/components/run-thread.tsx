'use client';

import { Message, MessageContent, MessageStack } from '@/components/nexus-ui/message';
import { Thread, ThreadContent, ThreadScrollToBottom } from '@/components/nexus-ui/thread';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { RunView } from '@/lib/events/reducer';
import { ResearchTimeline } from './research-timeline';
import { RunActions } from './run-actions';
import type { CanvasController } from './run-screen';

export function RunThread({
  view,
  canvas,
  onCompare,
}: {
  view: RunView;
  canvas?: CanvasController;
  onCompare?: () => void;
}) {
  return (
    <Thread className="h-full">
      <ThreadContent className="mx-auto w-full max-w-3xl items-stretch gap-6 px-4 py-8">
        <Message from="user">
          <MessageStack>
            <MessageContent className="whitespace-pre-wrap">{view.prompt}</MessageContent>
          </MessageStack>
        </Message>

        <Message from="assistant" className="max-w-full">
          <MessageStack>
            <MessageContent className="flex flex-col gap-4 px-0">
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
            </MessageContent>
          </MessageStack>
        </Message>
      </ThreadContent>
      <ThreadScrollToBottom />
    </Thread>
  );
}
