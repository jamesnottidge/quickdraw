// A tiny mdast transform. It is written against plain objects so it needs no extra dependency.
type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

const MARKER = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'citationRef']);

function splitText(value: string, max: number): Node[] {
  const parts: Node[] = [];
  let last = 0;
  for (const match of value.matchAll(MARKER)) {
    const numbers = match[1].split(',').map((s) => Number(s.trim()));
    if (!numbers.every((n) => n >= 1 && n <= max)) continue;
    const at = match.index ?? 0;
    if (at > last) parts.push({ type: 'text', value: value.slice(last, at) });
    for (const n of numbers) {
      parts.push({ type: 'citationRef', children: [], data: { hName: 'citation-ref', hProperties: { n } } });
    }
    last = at + match[0].length;
  }
  if (last === 0) return [{ type: 'text', value }];
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function transform(node: Node, max: number): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: Node[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitText(child.value, max));
    } else {
      transform(child, max);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark plugin: `[n]` markers (1..max) become `<citation-ref n="…">` elements. */
export function remarkCitations(options: { max: number }) {
  // `any` keeps this assignable to unified's Plugin type without importing mdast types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    if (options.max > 0) transform(tree as Node, options.max);
  };
}
