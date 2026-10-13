'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { closeOpenFences } from '@/lib/markdown/closeOpenFences';

/** Raw HTML is skipped, links open safely, and images never auto-load. */
export function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {streaming ? closeOpenFences(text) : text}
      </ReactMarkdown>
    </div>
  );
}
