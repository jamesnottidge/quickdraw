import 'dotenv/config';
import { migrate } from '../src/lib/store/migrate';
import { createPostgresDb } from '../src/lib/store/pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

migrate(createPostgresDb(url)).then(
  (applied) => {
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'already up to date');
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
