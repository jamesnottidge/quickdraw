'use client';

import { ArrowUp } from 'lucide-react';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActionGroup,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/nexus-ui/prompt-input';
import { Button } from '@/components/ui/button';

export const MIN_MESSAGE = 3;
export const MAX_MESSAGE = 2000;

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Ask a research question…',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const trimmed = value.trim();
  const valid = trimmed.length >= MIN_MESSAGE && trimmed.length <= MAX_MESSAGE;
  const submit = () => {
    if (valid && !disabled) onSubmit();
  };

  return (
    <PromptInput onSubmit={submit}>
      <PromptInputTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={MAX_MESSAGE}
      />
      <PromptInputActions>
        <PromptInputActionGroup>
          <span className="px-2 text-xs text-muted-foreground">{trimmed.length}/{MAX_MESSAGE}</span>
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
  );
}
