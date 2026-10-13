/** Models the harness is compared against. Edit freely; ids must exist on OpenRouter. */
export const COMPARISON_MODELS: { id: string; label: string }[] = [
  { id: 'meta/muse-spark-1.3', label: 'Muse Spark 1.3' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5' },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'openai/gpt-6-sol', label: 'GPT-6 Sol' },
];
