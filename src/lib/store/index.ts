import type { Db } from './db';

const g = globalThis as unknown as { __cdmDb?: Promise<Db> };

async function open(): Promise<Db> {
  if (process.env.FAKE_MODELS === '1' && !process.env.DATABASE_URL) {
    const { createPgliteDb } = await import('./pglite');
    const { migrate } = await import('./migrate');
    const db = await createPgliteDb();
    await migrate(db);
    return db;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { createPostgresDb } = await import('./pg');
  return createPostgresDb(url);
}

export function getDb(): Promise<Db> {
  if (!g.__cdmDb) g.__cdmDb = open();
  return g.__cdmDb;
}
