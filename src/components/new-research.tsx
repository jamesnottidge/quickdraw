'use client';

import { ArrowUp } from 'lucide-react';
import { useState } from 'react';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActionGroup,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/nexus-ui/prompt-input';
import { Suggestion, SuggestionList, Suggestions } from '@/components/nexus-ui/suggestions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const EXAMPLES = [
  'How do chunking strategies affect retrieval quality for legal documents in RAG systems?',
  'What are the main trade-offs between SQLite and Postgres for a small SaaS app?',
  'How do honeybees navigate back to their hive?',
];

export function NewResearch({
  onSubmit,
  disabled,
  error,
}: {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
  error: string | null;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const valid = trimmed.length >= 3 && trimmed.length <= 2000;

  function submit() {
    if (valid && !disabled) onSubmit(trimmed);
  }

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
        <PromptInput onSubmit={submit}>
          <PromptInputTextarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask a research question…"
            disabled={disabled}
            maxLength={2000}
          />
          <PromptInputActions>
            <PromptInputActionGroup>
              <span className="px-2 text-xs text-muted-foreground">{trimmed.length}/2000</span>
            </PromptInputActionGroup>
            <PromptInputActionGroup>
              <PromptInputAction asChild tooltip={{ content: 'Send', shortcut: 'Enter' }}>
                <Button type="button" size="icon" className="rounded-full" aria-label="Send" disabled={!valid || disabled} onClick={submit}>
                  <ArrowUp className="size-4" />
                </Button>
              </PromptInputAction>
            </PromptInputActionGroup>
          </PromptInputActions>
        </PromptInput>

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
