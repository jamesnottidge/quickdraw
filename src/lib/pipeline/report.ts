import type { AppConfig } from '@/lib/config';
import type { EventBody } from '@/lib/events/schema';
import type { MuseEvent, MuseMessage, MuseRequest } from '@/lib/models/muse';
import { REPORT_SYSTEM } from '@/lib/prompts';
import type { GatheredSummary } from './gather';

export interface ReportDeps {
  config: AppConfig;
  muse: (req: MuseRequest) => AsyncIterable<MuseEvent>;
}

// Untrusted text must not be able to close or open our <source> delimiters.
const defuse = (s: string) => s.replace(/<(\/?)source/gi, '‹$1source');
// Page titles and URLs are attacker-controlled too, so they get the same treatment as summaries.
const attr = (s: string) => defuse(s.replace(/["\n\r]/g, ' ')).slice(0, 200);

export function buildReportMessages(question: string, summaries: GatheredSummary[]): MuseMessage[] {
  const sources = summaries
    .map(
      (s, i) =>
        `<source id="${i + 1}" url="${attr(s.url)}" title="${attr(s.title)}">\n${defuse(s.summary)}\n</source>`,
    )
    .join('\n\n');
  return [
    { role: 'system', content: REPORT_SYSTEM },
    { role: 'user', content: `Research request: ${question}\n\nSources:\n\n${sources}` },
  ];
}

const mdText = (s: string) => s.replace(/\[/g, '(').replace(/\]/g, ')');
const mdUrl = (s: string) => s.replace(/\)/g, '%29').replace(/\s/g, '%20');

export function sourcesSection(summaries: GatheredSummary[]): string {
  const lines = summaries.map((s, i) => `${i + 1}. [${mdText(s.title)}](${mdUrl(s.url)})`);
  return `\n\n## Sources\n\n${lines.join('\n')}\n`;
}

export function noSourcesReport(queries: string[]): string {
  const tried = queries.map((q) => `- ${q}`).join('\n');
  return `# No report\n\nI couldn't find usable sources for this request, so I haven't written a report.\n\nSearches tried:\n\n${tried}\n\nTry rephrasing the request or making it more specific.`;
}

export async function* writeReport(
  question: string,
  summaries: GatheredSummary[],
  deps: ReportDeps,
): AsyncGenerator<EventBody, string> {
  let full = '';
  let buffer = '';
  let finishReason: string | null = null;
  const flush = function* (): Generator<EventBody> {
    if (buffer) {
      yield { type: 'report_delta', text: buffer };
      buffer = '';
    }
  };

  for await (const ev of deps.muse({
    messages: buildReportMessages(question, summaries),
    maxTokens: deps.config.report.maxTokens,
    reasoningEffort: deps.config.reasoning.report,
  })) {
    if (ev.type === 'text') {
      full += ev.delta;
      buffer += ev.delta;
      if (buffer.length >= 120 || buffer.includes('\n')) yield* flush();
    } else if (ev.type === 'finish') {
      finishReason = ev.reason;
    }
  }
  yield* flush();
  if (full.trim() === '') {
    throw new Error(
      finishReason === 'length'
        ? 'The model used its whole token budget thinking and returned no report'
        : 'The model returned an empty report',
    );
  }

  let tail = '';
  if (finishReason === 'length') tail += '\n\n*(The report was cut off at the length limit.)*';
  tail += sourcesSection(summaries);
  full += tail;
  yield { type: 'report_delta', text: tail };
  yield { type: 'report_done', text: full };
  return full;
}
