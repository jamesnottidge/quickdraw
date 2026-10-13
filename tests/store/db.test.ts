import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '@/lib/store/pglite';
import { migrate } from '@/lib/store/migrate';
import { cleanText, jsonParam } from '@/lib/store/util';

describe('migrate', () => {
  it('creates every table, and running it twice is a no-op', async () => {
    const db = await createPgliteDb();
    const first = await migrate(db);
    expect(first).toEqual(['001_init.sql', '002_quota.sql']);
    expect(await migrate(db)).toEqual([]);
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = tables.map((t) => t.table_name);
    for (const t of ['sessions', 'runs', 'events', 'model_calls', 'pages', 'reconnects', 'spend_ledger', 'quota_usage']) {
      expect(names).toContain(t);
    }
  });

  it('supports parameterised queries', async () => {
    const db = await createPgliteDb();
    const rows = await db.query<{ n: number }>('select $1::int as n', [7]);
    expect(rows[0].n).toBe(7);
  });
});

describe('util', () => {
  it('strips NUL characters from text and JSON params', () => {
    expect(cleanText('a\u0000b')).toBe('ab');
    const json = jsonParam({ text: 'x\u0000y' });
    expect(json).not.toContain('\\u0000');
    expect(JSON.parse(json)).toEqual({ text: 'xy' });
    expect(jsonParam(undefined)).toBe('null');
  });
});
