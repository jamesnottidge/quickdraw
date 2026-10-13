'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The chat-message layout from Nexus UI's `message` component (same markup and classes), without the markdown
 * renderer that component bundles. That renderer (streamdown with mermaid, katex and a syntax highlighter) added
 * about 1.7 MB of JavaScript to every page and is never used: reports render through react-markdown instead.
 */
type MessageFrom = 'user' | 'assistant';
const MessageContext = React.createContext<{ from: MessageFrom }>({ from: 'assistant' });

export function Message({
  className,
  from,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { from: MessageFrom }) {
  return (
    <MessageContext.Provider value={{ from }}>
      <div
        data-slot="message"
        role="article"
        aria-label={from === 'user' ? 'User message' : 'Assistant message'}
        className={cn('group/message flex w-full max-w-[90%] items-start gap-2', from === 'user' ? 'ms-auto' : 'me-auto', className)}
        {...props}
      >
        {children}
      </div>
    </MessageContext.Provider>
  );
}

export function MessageStack({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { from } = React.useContext(MessageContext);
  return (
    <div
      data-slot="message-stack"
      className={cn('flex w-full flex-col gap-2', from === 'user' ? 'items-end' : 'items-start', className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { from } = React.useContext(MessageContext);
  return (
    <div
      data-slot="message-content"
      className={cn(
        'rounded-2xl text-sm leading-6.5 text-primary',
        from === 'user' ? 'w-fit bg-secondary px-4 py-2' : 'mb-1 w-full bg-transparent px-2',
        className,
      )}
      {...props}
    />
  );
}
