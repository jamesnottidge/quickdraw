import type { ReasoningEffort } from '@/lib/config';
import { createSseParser } from '@/lib/sse/parser';
import { HttpError } from '@/lib/http/errors';
import type { ModelCtx, Stage } from './types';
import { ToolCallAccumulator, type CompleteToolCall, type InvalidToolCall } from './toolcall-accumulator';

export type MuseMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface MuseTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface MuseRequest {
  messages: MuseMessage[];
  tools?: MuseTool[];
  /** Includes reasoning tokens: keep it generous or the answer can be starved. */
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export type MuseEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_drafting'; name: string }
  | { type: 'tool_call'; call: CompleteToolCall }
  | { type: 'tool_call_invalid'; call: InvalidToolCall }
  | { type: 'finish'; reason: string | null; costUsd: number; inputTokens: number; outputTokens: number };

interface Chunk {
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  choices?: {
    delta?: { content?: string | null; tool_calls?: import('./toolcall-accumulator').ToolCallDelta[] };
    finish_reason?: string | null;
  }[];
}

function parseChunk(payload: string): Chunk {
  try {
    return JSON.parse(payload) as Chunk;
  } catch {
    throw new Error('Malformed chunk from the model stream');
  }
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function* streamMuse(
  ctx: ModelCtx,
  model: string,
  stage: Stage,
  req: MuseRequest,
): AsyncGenerator<MuseEvent> {
  const body: Record<string, unknown> = { model, messages: req.messages, stream: true };
  if (req.tools?.length) body.tools = req.tools;
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.reasoningEffort) body.reasoning = { effort: req.reasoningEffort };

  const started = Date.now();
  let status = 0;
  let content = '';
  let finishReason: string | null = null;
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let error: string | undefined;
  const acc = new ToolCallAccumulator();

  try {
    const res = await ctx.fetchImpl(`${ctx.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    status = res.status;
    if (!res.ok) throw new HttpError(status, await res.text());
    if (!res.body) throw new Error('The model returned no response body');

    const parser = createSseParser();
    const reader = res.body.getReader();
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const payload of parser.push(value)) {
        if (payload === '[DONE]') {
          finished = true;
          break;
        }
        const chunk = parseChunk(payload);
        if (chunk.error) throw new Error(`Model stream error: ${chunk.error.message ?? 'unknown'}`);
        if (chunk.usage) {
          usage = {
            inputTokens: n(chunk.usage.prompt_tokens),
            outputTokens: n(chunk.usage.completion_tokens),
            costUsd: n(chunk.usage.cost),
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          content += choice.delta.content;
          yield { type: 'text', delta: choice.delta.content };
        }
        if (choice.delta?.tool_calls?.length) {
          for (const s of acc.addDelta(choice.delta.tool_calls).started) {
            yield { type: 'tool_drafting', name: s.name };
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
    await reader.cancel().catch(() => {});

    if (finishReason === null) {
      throw new Error('The model stream ended before a finish reason; discarding partial output');
    }
    const { complete, invalid } = acc.finish();
    if (finishReason === 'length') {
      const truncated = [...complete.map((c) => ({ id: c.id, name: c.name, rawArgs: c.rawArgs })), ...invalid];
      for (const c of truncated) {
        yield {
          type: 'tool_call_invalid',
          call: { id: c.id, name: c.name, rawArgs: c.rawArgs, error: 'Output was truncated (max tokens) before the tool call finished' },
        };
      }
    } else {
      for (const call of complete) yield { type: 'tool_call', call };
      for (const call of invalid) yield { type: 'tool_call_invalid', call };
    }
    yield { type: 'finish', reason: finishReason, ...usage };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    try {
      await ctx.record({
        stage,
        model,
        request: body,
        response: { content, finishReason, toolCalls: acc.snapshot(), error },
        httpStatus: status,
        latencyMs: Date.now() - started,
        ...usage,
      });
    } catch {
      /* recording must never fail the call */
    }
  }
}
