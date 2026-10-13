'use client';

import { useState } from 'react';

const EXAMPLES = [
  'How do chunking strategies affect retrieval quality for legal documents in RAG systems?',
  'What are the main trade-offs between SQLite and Postgres for a small SaaS app?',
];

export function PromptForm({ onSubmit, disabled }: { onSubmit: (prompt: string) => void; disabled: boolean }) {
  const [prompt, setPrompt] = useState('');
  const tooShort = prompt.trim().length < 3;
  return (
    <form
      className="prompt-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort && !disabled) onSubmit(prompt.trim());
      }}
    >
      <label htmlFor="prompt">What do you want researched?</label>
      <textarea
        id="prompt"
        value={prompt}
        maxLength={2000}
        rows={4}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask a research question…"
      />
      <div className="prompt-actions">
        <button type="submit" disabled={disabled || tooShort}>
          Run research
        </button>
        <span className="muted">{prompt.length}/2000</span>
      </div>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button type="button" key={ex} className="chip" onClick={() => setPrompt(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
