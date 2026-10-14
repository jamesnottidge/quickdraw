'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSidebar } from '@/components/ui/sidebar';
import { useConversation } from '@/hooks/useConversation';
import { Composer } from './composer';
import { ConversationScreen } from './conversation-screen';
import { NewResearch } from './new-research';

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p role={error ? 'alert' : undefined} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {children}
      </p>
    </div>
  );
}

/** A conversation with Quickdraw: new (no id) or a saved one. */
export function Conversation({ id }: { id?: string }) {
  const { turns, load, error, sending, send } = useConversation(id);
  const sidebar = useSidebar();
  const [draft, setDraft] = useState('');

  if (load === 'loading') return <Centered>Loading conversation…</Centered>;
  if (load === 'missing') return <Centered error>That conversation doesn&rsquo;t exist.</Centered>;
  if (load === 'error') return <Centered error>Couldn&rsquo;t load this conversation. Try reloading.</Centered>;

  if (turns.length === 0) {
    return (
      <NewResearch
        onSubmit={(message) => {
          sidebar.setOpen(false);
          return send(message);
        }}
        disabled={sending}
        error={error}
      />
    );
  }

  async function submit() {
    const message = draft.trim();
    if (await send(message)) setDraft('');
  }

  return (
    <ConversationScreen
      turns={turns}
      footer={
        <>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void submit()}
            disabled={sending}
            placeholder="Ask a research question…"
          />
        </>
      }
    />
  );
}
