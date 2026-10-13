import { describe, it, expect } from 'vitest';
import { buildArtifact } from '@/lib/pipeline/artifact';
import { ARTIFACT_CSP } from '@/lib/artifact/validate';
import { ARTIFACT_SYSTEM } from '@/lib/artifact/prompt';
import type { MuseEvent, MuseRequest } from '@/lib/models/muse';
import { loadConfig } from '@/lib/config';
import { drain } from '../helpers/gen';

const config = loadConfig({});
const sources = [{ n: 1, url: 'https://a.test/1', title: 'A' }];
const doc = '<!doctype html><html><head><title>T</title></head><body><button>go</button></body></html>';
const fin: MuseEvent = { type: 'finish', reason: 'stop', costUsd: 0, inputTokens: 0, outputTokens: 0 };

function museOf(text: string, opts: { throws?: Error } = {}) {
  const requests: MuseRequest[] = [];
  return {
    requests,
    muse: (req: MuseRequest): AsyncIterable<MuseEvent> => {
      requests.push(req);
      return (async function* (): AsyncGenerator<MuseEvent> {
        if (opts.throws) throw opts.throws;
        for (const part of text.match(/[\s\S]{1,40}/g) ?? []) yield { type: 'text', delta: part };
        yield fin;
      })();
    },
  };
}

const T0 = 1_000_000;
const run = (muse: ReturnType<typeof museOf>['muse'], now = T0, cfg = config) =>
  drain(buildArtifact('# Report\n\nBody [1].', sources, T0, { config: cfg, muse, now: () => now }));

describe('buildArtifact', () => {
  it('asks Muse with the artifact prompt, stage, effort, token cap and a deadline signal', async () => {
    const { muse, requests } = museOf(doc);
    await run(muse);
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0]).toEqual({ role: 'system', content: ARTIFACT_SYSTEM });
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].stage).toBe('artifact');
    expect(requests[0].reasoningEffort).toBe(config.reasoning.artifact);
    expect(requests[0].maxTokens).toBe(config.artifact.maxTokens);
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('emits started then done, with the hardened document', async () => {
    const { events } = await run(museOf('```html\n' + doc + '\n```').muse);
    expect(events.map((e) => e.type)).toEqual(['artifact_started', 'artifact_done']);
    const done = events[1] as { type: 'artifact_done'; html: string };
    expect(done.html).toContain(ARTIFACT_CSP);
    expect(done.html).toContain('<button>go</button>');
  });

  it('REVIEW FOCUS: garbage output becomes artifact_failed, never an exception', async () => {
    const cases: [string, RegExp][] = [
      ['', /HTML document/i],
      ['I am sorry, I cannot do that.', /HTML document/i],
      ['<!doctype html><html><body>cut off', /cut off/i],
    ];
    for (const [text, reason] of cases) {
      const { events } = await run(museOf(text).muse);
      expect(events.map((e) => e.type)).toEqual(['artifact_started', 'artifact_failed']);
      expect((events[1] as { reason: string }).reason).toMatch(reason);
    }
  });

  it('fails an oversized document', async () => {
    const small = { ...config, artifact: { ...config.artifact, maxChars: 50 } };
    const { events } = await run(museOf(doc).muse, T0, small);
    expect(events.at(-1)).toMatchObject({ type: 'artifact_failed', reason: expect.stringMatching(/too large/i) });
  });

  it('reports a Muse error as artifact_failed', async () => {
    const { events } = await run(museOf('', { throws: new Error('OpenRouter 503') }).muse);
    expect(events.at(-1)).toEqual({ type: 'artifact_failed', reason: 'OpenRouter 503' });
  });

  it('skips the stage without calling Muse when not enough of the run budget remains', async () => {
    const { muse, requests } = museOf(doc);
    const lateNow = T0 + config.maxRunMs - config.artifact.minRemainingMs + 1;
    const { events } = await run(muse, lateNow);
    expect(requests).toHaveLength(0);
    expect(events).toEqual([{ type: 'artifact_failed', reason: expect.stringMatching(/skipped/i) }]);
  });
});
