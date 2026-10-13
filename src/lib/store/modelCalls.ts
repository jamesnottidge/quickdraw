import type { ModelCallRecord } from '@/lib/models/types';
import type { Db } from './db';
import { jsonParam } from './util';

export async function insertModelCall(db: Db, runId: string, rec: ModelCallRecord): Promise<void> {
  await db.query(
    `insert into model_calls(run_id, stage, model, request, response, http_status, latency_ms, input_tokens, output_tokens, cost_usd)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)`,
    [
      runId,
      rec.stage,
      rec.model,
      jsonParam(rec.request),
      jsonParam(rec.response),
      rec.httpStatus,
      Math.round(rec.latencyMs),
      rec.inputTokens,
      rec.outputTokens,
      rec.costUsd,
    ],
  );
}

export async function sumRunCost(db: Db, runId: string): Promise<number> {
  const rows = await db.query<{ total: number }>(
    `select coalesce(sum(cost_usd), 0)::float8 as total from model_calls where run_id = $1`,
    [runId],
  );
  return Number(rows[0].total);
}
