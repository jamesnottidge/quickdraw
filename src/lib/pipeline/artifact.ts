import type { AppConfig } from '@/lib/config';
import type { EventBody } from '@/lib/events/schema';
import { buildArtifactMessages } from '@/lib/artifact/prompt';
import { hardenArtifactHtml, validateArtifact } from '@/lib/artifact/validate';
import type { MuseEvent, MuseRequest } from '@/lib/models/muse';

export interface ArtifactDeps {
  config: AppConfig;
  muse: (req: MuseRequest) => AsyncIterable<MuseEvent>;
  now?: () => number;
}

export interface SourceInfo {
  n: number;
  url: string;
  title: string;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Builds the interactive artifact from the finished report. Time-boxed and failure-tolerant:
 * every problem becomes `artifact_failed`; nothing here throws.
 */
export async function* buildArtifact(
  report: string,
  sources: SourceInfo[],
  startedAt: number,
  deps: ArtifactDeps,
): AsyncGenerator<EventBody, void> {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const remaining = config.maxRunMs - (now() - startedAt);
  if (remaining < config.artifact.minRemainingMs) {
    yield { type: 'artifact_failed', reason: 'skipped: not enough time left in this run' };
    return;
  }

  yield { type: 'artifact_started' };
  const budgetMs = Math.max(1_000, Math.min(remaining - 15_000, config.artifact.maxMs));
  let text = '';
  try {
    for await (const ev of deps.muse({
      messages: buildArtifactMessages(report, sources),
      stage: 'artifact',
      maxTokens: config.artifact.maxTokens,
      reasoningEffort: config.reasoning.artifact,
      signal: AbortSignal.timeout(budgetMs),
    })) {
      if (ev.type === 'text') text += ev.delta;
    }
  } catch (e) {
    const timedOut = (e as { name?: string } | null)?.name === 'TimeoutError';
    yield { type: 'artifact_failed', reason: timedOut ? 'timed out while building the interactive view' : errMsg(e) };
    return;
  }

  const checked = validateArtifact(text, config.artifact.maxChars);
  if (!checked.ok) {
    yield { type: 'artifact_failed', reason: checked.reason };
    return;
  }
  yield { type: 'artifact_done', html: hardenArtifactHtml(checked.html) };
}
