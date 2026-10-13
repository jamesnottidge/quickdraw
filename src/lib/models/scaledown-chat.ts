import { z } from 'zod';
import type { AppConfig } from '@/lib/config';
import { postJson } from '@/lib/http/postJson';
import { TLDR_INSTRUCTION } from '@/lib/prompts';
import type { ModelCtx, Stage } from './types';

export interface BinaryInput {
  mime: string;
  dataUrl: string;
  filename: string;
}

export interface SummarizeInput {
  instruction: string;
  text?: string;
  binary?: BinaryInput;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const usageOf = (j: unknown) => {
  const u = (j as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  return { inputTokens: n(u.prompt_tokens), outputTokens: n(u.completion_tokens), costUsd: n(u.cost) };
};

const chatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1),
});

async function chat(
  ctx: ModelCtx,
  stage: Stage,
  model: string,
  extra: Record<string, unknown>,
  messages: unknown[],
): Promise<{ content: string; costUsd: number }> {
  const json = await postJson<unknown>({
    ctx,
    path: '/v1/chat/completions',
    body: { model, messages, ...extra },
    stage,
    model,
    usage: usageOf,
  });
  const content = chatResponse.parse(json).choices[0].message.content ?? '';
  return { content, costUsd: usageOf(json).costUsd };
}

function userContent(input: SummarizeInput): string | unknown[] {
  if (input.binary) {
    const part = input.binary.mime.startsWith('image/')
      ? { type: 'image_url', image_url: { url: input.binary.dataUrl } }
      : { type: 'file', file: { filename: input.binary.filename, file_data: input.binary.dataUrl } };
    return [{ type: 'text', text: 'Summarize the attached document.' }, part];
  }
  return input.text ?? '';
}

export async function summarize(
  ctx: ModelCtx,
  cfg: AppConfig,
  input: SummarizeInput,
): Promise<{ text: string; costUsd: number }> {
  const { content, costUsd } = await chat(
    ctx,
    'summarize',
    cfg.models.summarize,
    { max_tokens: 1500 },
    [
      { role: 'system', content: input.instruction },
      { role: 'user', content: userContent(input) },
    ],
  );
  const text = content.trim();
  if (!text) throw new Error('summarize returned empty content');
  return { text, costUsd };
}

const extractContent = z.object({
  entities: z.array(z.object({ type: z.string(), text: z.string() })),
});

export async function extractTldr(
  ctx: ModelCtx,
  cfg: AppConfig,
  reportText: string,
): Promise<{ text: string; costUsd: number }> {
  const { content, costUsd } = await chat(
    ctx,
    'tldr',
    cfg.models.extract,
    { provider: { options: { scaledown: { entities: { tldr: TLDR_INSTRUCTION } } } } },
    [{ role: 'user', content: reportText.slice(0, 100_000) }],
  );
  let parsed: z.infer<typeof extractContent>;
  try {
    parsed = extractContent.parse(JSON.parse(content));
  } catch {
    throw new Error('extract returned content that is not the expected entities JSON');
  }
  const tldr = parsed.entities.find((e) => e.type === 'tldr' && e.text.trim());
  if (!tldr) throw new Error('extract returned no tldr entity');
  return { text: tldr.text.trim(), costUsd };
}

export async function makeTldr(
  ctx: ModelCtx,
  cfg: AppConfig,
  reportText: string,
): Promise<{ text: string; costUsd: number }> {
  if (cfg.tldrModel === 'extract') {
    try {
      return await extractTldr(ctx, cfg, reportText);
    } catch {
      /* fall through to summarize */
    }
  }
  return summarize(ctx, cfg, {
    instruction: 'Write a one-sentence TLDR of the text. Output only that sentence.',
    text: reportText.slice(0, 100_000),
  });
}
