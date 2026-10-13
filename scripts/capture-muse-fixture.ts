import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PLANNER_SYSTEM } from '../src/lib/prompts';
import { planTools } from '../src/lib/pipeline/tools';

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is not set');
const model = process.env.PLANNER_MODEL || 'meta/muse-spark-1.3-contributor';
const outDir = path.join(__dirname, '../tests/fixtures');
fs.mkdirSync(outDir, { recursive: true });

async function capture(name: string, body: Record<string, unknown>) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true, ...body }),
  });
  const text = await res.text();
  console.log(name, 'status', res.status, 'bytes', text.length, 'tool_calls mentions', (text.match(/tool_calls/g) ?? []).length);
  if (!res.ok) {
    console.log(text.slice(0, 500));
    return;
  }
  fs.writeFileSync(path.join(outDir, name), text);
}

(async () => {
  await capture('muse-tool-stream.sse', {
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: 'How do chunking strategies affect retrieval quality for legal documents in RAG systems?' },
    ],
    tools: planTools,
    max_tokens: 1000,
    reasoning: { effort: 'minimal' },
  });
  await capture('muse-text-stream.sse', {
    messages: [{ role: 'user', content: 'Write two short sentences about document chunking.' }],
    max_tokens: 800,
    reasoning: { effort: 'minimal' },
  });
})();
