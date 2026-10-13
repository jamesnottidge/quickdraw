import postgres from 'postgres';
import type { Db, Row } from './db';

export function createPostgresDb(url: string): Db {
  // prepare:false is required for Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  return {
    async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await sql.unsafe(text, params as any[])) as unknown as T[];
    },
    async exec(text: string): Promise<void> {
      await sql.unsafe(text);
    },
  };
}
