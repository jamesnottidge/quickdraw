'use client';

import { useState } from 'react';
import { Suggestion, SuggestionList, Suggestions } from '@/components/nexus-ui/suggestions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Composer } from './composer';

const EXAMPLES = [
  'How do chunking strategies affect retrieval quality for legal documents in RAG systems?',
  'What are the main trade-offs between SQLite and Postgres for a small SaaS app?',
  'How do honeybees navigate back to their hive?',
];

/** The empty state: the first message of a new conversation. */
export function NewResearch({
  onSubmit,
  disabled,
  error,
}: {
  onSubmit: (prompt: string) => Promise<boolean> | void;
  disabled: boolean;
  error: string | null;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-4 pb-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What do you want researched?</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          A language model plans the searches and writes the report. Small task-specific models score the queries, filter the
          pages and summarize them.
        </p>
      </div>

      <div className="flex w-full max-w-2xl flex-col gap-4">
        <Composer value={value} onChange={setValue} onSubmit={() => void onSubmit(value.trim())} disabled={disabled} />

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Suggestions onSelect={(v) => setValue(v)}>
          <SuggestionList orientation="vertical" className="items-stretch">
            {EXAMPLES.map((e) => (
              <Suggestion key={e} value={e} variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left">
                {e}
              </Suggestion>
            ))}
          </SuggestionList>
        </Suggestions>
      </div>
    </div>
  );
}
