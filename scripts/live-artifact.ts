import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { loadConfig } from '../src/lib/config';
import { streamMuse } from '../src/lib/models/muse';
import type { ModelCallRecord, ModelCtx } from '../src/lib/models/types';
import { buildArtifact } from '../src/lib/pipeline/artifact';

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is not set');

const REPORT = `# Chunking strategies and retrieval quality in legal RAG

## Overview
Legal documents are long, hierarchical and full of cross references, so how a pipeline splits them into chunks strongly affects what a retriever can find [1].

## Findings
- **Section-aware chunking** keeps a clause together with its heading and defined terms. In one evaluation it raised recall on long contracts by about 12 percent compared with fixed windows [1].
- **Fixed 512-token windows** often cut a clause away from the definitions it depends on, which led to hallucinated citations in generated answers [2].
- **Overlapping windows** reduced those errors but increased index size and cost [2].
- **Parent-document metadata** (document title, article number, effective date) attached to each chunk improved citation accuracy in review by lawyers [3].

## Trade-offs
| Strategy | Recall | Index size | Complexity |
|---|---|---|---|
| Fixed windows | Lower | Smallest | Low |
| Overlapping windows | Medium | Larger | Low |
| Section-aware | Highest | Medium | Higher |

## Conclusion
For statutes and contracts, prefer structure-aware chunking with parent metadata; use overlap as a fallback for unstructured text [1][2][3].`;

const SOURCES = [
  { n: 1, url: 'https://example.com/legal-rag-chunking', title: 'Chunking long contracts for retrieval' },
  { n: 2, url: 'https://research.example.org/fixed-windows', title: 'Why fixed windows hallucinate citations' },
  { n: 3, url: 'https://lawtech.example.net/parent-metadata', title: 'Parent metadata improves citation accuracy' },
];

(async () => {
  const calls: ModelCallRecord[] = [];
  const ctx: ModelCtx = {
    apiKey: key,
    baseUrl: 'https://openrouter.ai/api',
    fetchImpl: fetch,
    record: (r) => {
      calls.push(r);
    },
    retry: { retries: 2, baseMs: 500 },
  };
  const config = loadConfig();
  const muse = (req: Parameters<typeof streamMuse>[3]) => streamMuse(ctx, config.models.planner, req.stage ?? 'report', req);

  const t0 = Date.now();
  let html = '';
  let failure = '';
  for await (const ev of buildArtifact(REPORT, SOURCES, Date.now(), { config, muse })) {
    if (ev.type === 'artifact_done') html = ev.html;
    if (ev.type === 'artifact_failed') failure = ev.reason;
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const call = calls.at(-1);
  console.log(JSON.stringify({
    ok: !!html, failure, seconds: Number(seconds), htmlChars: html.length,
    inputTokens: call?.inputTokens, outputTokens: call?.outputTokens, costUsd: call?.costUsd,
  }, null, 2));
  if (!html) process.exit(1);

  const file = path.join(os.tmpdir(), 'cdm-live-artifact.html');
  fs.writeFileSync(file, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(html);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(os.tmpdir(), 'cdm-live-artifact.png'), fullPage: true });
  await browser.close();
  console.log('saved', file, 'and', path.join(os.tmpdir(), 'cdm-live-artifact.png'));
})();
