export interface CompleteToolCall {
  id: string;
  name: string;
  args: unknown;
  rawArgs: string;
}

export interface InvalidToolCall {
  id: string;
  name: string;
  rawArgs: string;
  error: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface Partial {
  id: string;
  name: string;
  args: string;
}

export class ToolCallAccumulator {
  private calls = new Map<number, Partial>();

  addDelta(deltas: ToolCallDelta[]): { started: { index: number; name: string }[] } {
    const started: { index: number; name: string }[] = [];
    for (const d of deltas) {
      let c = this.calls.get(d.index);
      if (!c) {
        c = { id: '', name: '', args: '' };
        this.calls.set(d.index, c);
      }
      if (d.id) c.id = d.id;
      if (d.function?.name && !c.name) {
        c.name = d.function.name;
        started.push({ index: d.index, name: c.name });
      }
      if (d.function?.arguments) c.args += d.function.arguments;
    }
    return { started };
  }

  /** Call only once the stream has ended with a finish reason. */
  finish(): { complete: CompleteToolCall[]; invalid: InvalidToolCall[] } {
    const complete: CompleteToolCall[] = [];
    const invalid: InvalidToolCall[] = [];
    for (const [index, c] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      const id = c.id || `call_${index}`;
      if (!c.name) {
        invalid.push({ id, name: '', rawArgs: c.args, error: 'Tool call is missing a function name' });
        continue;
      }
      const raw = c.args.trim() === '' ? '{}' : c.args;
      try {
        complete.push({ id, name: c.name, args: JSON.parse(raw), rawArgs: raw });
      } catch (e) {
        invalid.push({
          id,
          name: c.name,
          rawArgs: c.args,
          error: `Arguments are not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    return { complete, invalid };
  }

  snapshot(): unknown {
    return [...this.calls.entries()].map(([index, c]) => ({ index, ...c }));
  }
}
