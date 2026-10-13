import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';

export async function migrate(db: Db, dir = path.join(process.cwd(), 'db/migrations')): Promise<string[]> {
  await db.exec('create table if not exists _migrations (name text primary key)');
  const applied = new Set((await db.query<{ name: string }>('select name from _migrations')).map((r) => r.name));
  const files = fs.readdirSync(/* turbopackIgnore: true */ dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    await db.exec(fs.readFileSync(path.join(/* turbopackIgnore: true */ dir, file), 'utf8'));
    await db.query('insert into _migrations(name) values ($1)', [file]);
    ran.push(file);
  }
  return ran;
}
