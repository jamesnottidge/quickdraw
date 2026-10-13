import { PGlite } from '@electric-sql/pglite';
import type { Db, Row } from './db';

export async function createPgliteDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.waitReady;
  return {
    async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const res = await pg.query(text, params as any[]);
      return res.rows as T[];
    },
    async exec(text: string): Promise<void> {
      await pg.exec(text);
    },
  };
}
