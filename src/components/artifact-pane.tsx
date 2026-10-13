'use client';

import { TextShimmer } from '@/components/nexus-ui/text-shimmer';
import { Skeleton } from '@/components/ui/skeleton';
import { ARTIFACT_SANDBOX } from '@/lib/artifact/sandbox';
import type { ArtifactView } from '@/lib/events/reducer';

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function ArtifactPane({ artifact }: { artifact: ArtifactView }) {
  if (artifact.status === 'ready' && artifact.html) {
    return (
      <iframe
        title="Interactive view"
        sandbox={ARTIFACT_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={artifact.html}
        className="h-full w-full border-0 bg-background"
      />
    );
  }
  if (artifact.status === 'building') {
    return (
      <Message>
        <Skeleton className="h-40 w-full max-w-md rounded-xl" />
        <TextShimmer as="p" className="mt-4 text-sm">Building the interactive view…</TextShimmer>
        <p className="text-xs">This can take a minute. The report is ready to read.</p>
      </Message>
    );
  }
  if (artifact.status === 'failed') {
    return <Message><p>The interactive view isn&rsquo;t available for this run.</p><p className="text-xs">{artifact.reason}</p></Message>;
  }
  return <Message><p>No interactive view for this run.</p></Message>;
}
