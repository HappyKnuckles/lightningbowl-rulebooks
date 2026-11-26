// The whole API on your machine without Vercel or Neon: `npm run local [-- --import]`.
// Starts a Postgres kept in .local-db/ (the embedded one the tests use), imports the rulebooks on the
// first start (or with --import, which re-checks all of them), and serves the API like `npm run dev`.
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { query } from '../lib/db.js';
import { runImport } from '../lib/importer.js';
import { migrate } from '../lib/migrate.js';

const DIR = path.resolve(process.env.LOCAL_DB_DIR || '.local-db');
const PORT = Number(process.env.LOCAL_DB_PORT || 54329);
const USER = 'postgres';
const PASSWORD = 'local';

const pg = new EmbeddedPostgres({ databaseDir: DIR, user: USER, password: PASSWORD, port: PORT, persistent: true, onLog: () => {} });
if (!existsSync(path.join(DIR, 'PG_VERSION'))) {
  console.log(`Creating a local database in ${DIR}`);
  await pg.initialise();
}
await pg.start();

const stop = async () => {
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// set before the dev server loads .env.local, which doesn't override what is already set
process.env.DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres`;
process.env.ADMIN_SECRET ??= 'local';
process.env.CRON_SECRET ??= 'local';

await migrate({ log: () => {} });
const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM editions');
if (rows[0]!.n === 0 || process.argv.includes('--import')) {
  console.log('Importing the rulebooks (downloads every PDF, takes about a minute)…');
  const run = await runImport({ trigger: 'local' });
  if (!('skipped' in run)) console.log(`Import ${run.status}${run.errors.length ? `:\n  ${run.errors.join('\n  ')}` : ''}`);
}

console.log('Health needs "Authorization: Bearer local" (unless ADMIN_SECRET is set).');
await import('../dev-server.js');
