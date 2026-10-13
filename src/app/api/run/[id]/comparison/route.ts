import { loadConfig } from '@/lib/config';
import benchmarks from '@/lib/comparison/benchmarks.json';
import snapshot from '@/lib/comparison/prices.snapshot.json';
import { createPriceProvider } from '@/lib/comparison/prices';
import type { Benchmarks } from '@/lib/comparison/types';
import { buildComparison } from '@/lib/server/comparison';
import { getDb } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prices = createPriceProvider({ snapshot });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const out = await buildComparison(await getDb(), loadConfig(), id, { prices, benchmarks: benchmarks as Benchmarks });
    if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
    return Response.json(out.result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/run/[id]/comparison failed', e);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
