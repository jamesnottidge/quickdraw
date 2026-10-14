'use client';

import { use } from 'react';
import { ConversationScreen } from '@/components/conversation-screen';
import { useReplay } from '@/hooks/useRunStream';

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p role={error ? 'alert' : undefined} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {children}
      </p>
    </div>
  );
}

/** A single run by id, read-only. Conversations live at /c/<id>. */
export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, state } = useReplay(id);
  if (state === 'loading') return <Centered>Loading run…</Centered>;
  if (state === 'missing') return <Centered error>That run doesn&rsquo;t exist.</Centered>;
  if (state === 'error') return <Centered error>Couldn&rsquo;t load this run. Try reloading.</Centered>;
  return <ConversationScreen key={id} turns={[{ id, kind: 'research', prompt: view.prompt, runId: id, view }]} />;
}
