import fs from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OUT = process.env.OUT_DIR ?? '/tmp/cdm-shots';
const PROMPT = 'How do chunking strategies affect retrieval quality for legal documents in RAG systems?';
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

fs.mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
}


const RICH_ID = '22222222-2222-4222-8222-222222222222';
const RICH_REPORT = `# Chunking strategies and retrieval quality in legal RAG

Legal documents are long, hierarchical and full of cross references, so how a pipeline splits them into chunks strongly affects what a retriever can find [1]. This report compares three strategies and what the evidence says about each [1][2][3].

## Findings

- **Section-aware chunking** keeps a clause together with its heading and defined terms [1].
  - In one evaluation it raised recall on long contracts by about 12 percent.
  - It needs a reliable structure parser, which scanned documents often lack.
- **Fixed 512-token windows** often cut a clause away from the definitions it depends on [2].
- **Overlapping windows** reduce those errors but increase index size and cost [2, 3].

> "The unit of retrieval should be the unit of meaning, not the unit of tokenization." This framing recurs across the practitioner write-ups [3].

## Trade-offs

| Strategy | Recall | Index size | Complexity |
|---|---|---|---|
| Fixed windows | Lower | Smallest | Low |
| Overlapping windows | Medium | Larger | Low |
| Section-aware | Highest | Medium | Higher |

A minimal section-aware splitter looks like this:

\`\`\`python
def split(doc):
    for section in doc.sections:
        yield Chunk(text=section.text, meta={"title": doc.title, "path": section.path})
\`\`\`

## Conclusion

For statutes and contracts, prefer structure-aware chunking with parent metadata, and use \`overlap\` only as a fallback for unstructured text.

## Sources

1. [Chunking long contracts for retrieval](https://example.com/a)
`;
async function richReport(browser: import('@playwright/test').Browser, scheme: 'light' | 'dark', vp: { width: number; height: number }, name: string) {
  const context = await browser.newContext({ viewport: vp, colorScheme: scheme });
  const page = await context.newPage();
  const sources = [
    { n: 1, url: 'https://example.com/legal-rag-chunking', title: 'Chunking long contracts for retrieval', snippet: 'Section-aware chunking keeps clauses together and raised recall by 12 percent.' },
    { n: 2, url: 'https://research.example.org/fixed-windows', title: 'Why fixed windows hallucinate citations', snippet: 'Fixed windows split clauses from the definitions they rely on.' },
    { n: 3, url: 'https://lawtech.example.net/parent-metadata', title: 'Parent metadata improves citation accuracy', snippet: 'Attaching document and section metadata to chunks helped reviewers.' },
  ];
  const ev = (seq: number, body: object) => ({ runId: RICH_ID, seq, ts: seq * 1000, ...body });
  const events = [
    ev(1, { type: 'run_started', prompt: 'How do chunking strategies affect retrieval quality for legal documents?' }),
    ev(2, { type: 'sources_ready', sources }),
    ev(3, { type: 'report_done', text: RICH_REPORT }),
    ev(4, { type: 'tldr_done', text: 'Structure-aware chunking with parent metadata beats fixed windows for legal text.' }),
    ev(5, { type: 'run_finished', costUsd: 0.0123 }),
  ];
  await page.route(`**/api/run/${RICH_ID}*`, (route) =>
    route.fulfill({ json: { run: { id: RICH_ID, prompt: 'rich', status: 'finished' }, events, active: false } }),
  );
  await page.goto(`${BASE}/run/${RICH_ID}`);
  const phone = vp.width < 500;
  await (phone ? page.getByRole('dialog') : page.getByRole('complementary', { name: 'Report canvas' })).waitFor();
  await shot(page, name);
  const panel = (phone ? page.getByRole('dialog') : page.getByRole('complementary', { name: 'Report canvas' })).getByRole('tabpanel').first();
  await panel.evaluate((el) => el.scrollTo(0, 760));
  await shot(page, `${name}-lower`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark'] as const) {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      const prefix = `${scheme}-${vpName}`;
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      const phone = vpName === 'phone';

      await page.goto(BASE);
      await shot(page, `${prefix}-01-home`);

      await page.getByRole('textbox').fill(PROMPT);
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByText('Researching…').first().waitFor();
      await page.waitForTimeout(1400);
      await shot(page, `${prefix}-02-planning`);
      await page.waitForTimeout(3000);
      await shot(page, `${prefix}-02b-reading`);

      const canvas = phone ? page.getByRole('dialog') : page.getByRole('complementary', { name: 'Report canvas' });
      await canvas.waitFor({ timeout: 90_000 });
      await shot(page, `${prefix}-03-report`);

      await canvas.getByRole('tab', { name: /Interactive view/ }).click();
      await page.locator('iframe[title="Interactive view"]').waitFor({ timeout: 60_000 });
      await shot(page, `${prefix}-04-interactive`);

      await page.getByRole('button', { name: 'Collapse canvas' }).click();
      await shot(page, `${prefix}-05-thread-finished`);

      await page.getByRole('button', { name: 'Compare cost and speed' }).click();
      await page.getByRole('dialog').getByRole('row', { name: /This harness/ }).waitFor();
      await shot(page, `${prefix}-06-compare`);
      await context.close();
      await richReport(browser, scheme, viewport, `${prefix}-07-rich-report`);
    }
  }
  await browser.close();
})();
