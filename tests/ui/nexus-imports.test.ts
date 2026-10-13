import { describe, it, expect } from 'vitest';

const modules: Record<string, string[]> = {
  '@/components/nexus-ui/prompt-input': ['PromptInput', 'PromptInputTextarea', 'PromptInputActions', 'PromptInputActionGroup', 'PromptInputAction'],
  '@/components/nexus-ui/suggestions': ['Suggestions', 'SuggestionList', 'Suggestion'],
  '@/components/nexus-ui/thread': ['Thread', 'ThreadContent', 'ThreadScrollToBottom'],
  '@/components/chat-message': ['Message', 'MessageStack', 'MessageContent'],
  '@/components/nexus-ui/chain-of-thought': ['ChainOfThought', 'ChainOfThoughtTrigger', 'ChainOfThoughtContent', 'ChainOfThoughtStep', 'ChainOfThoughtStepTitle', 'ChainOfThoughtStepContent', 'ChainOfThoughtComplete'],
  '@/components/nexus-ui/citation': ['Citation', 'CitationTrigger', 'CitationContent', 'CitationItem'],
  '@/components/nexus-ui/text-shimmer': ['TextShimmer'],
  '@/components/ui/sidebar': ['Sidebar', 'SidebarProvider', 'SidebarInset', 'SidebarMenuButton'],
  '@/components/ui/tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'],
  '@/components/ui/dialog': ['Dialog', 'DialogContent', 'DialogTitle'],
};

describe('UI foundation', () => {
  for (const [path, names] of Object.entries(modules)) {
    it(`${path} resolves and exports ${names.length} parts`, async () => {
      const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
      for (const name of names) expect(mod[name], `${path} should export ${name}`).toBeDefined();
    });
  }

  it('mergeRefs sets callback and object refs', async () => {
    const { mergeRefs } = await import('@/lib/merge-refs');
    const calls: unknown[] = [];
    const obj = { current: null as unknown };
    mergeRefs((n: unknown) => { calls.push(n); }, obj)('node');
    expect(calls).toEqual(['node']);
    expect(obj.current).toBe('node');
  });
});
