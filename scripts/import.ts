// Runs the import locally: `npm run import [-- <rulebook-or-association-id>...] [--force]`.
// --force re-reads documents that didn't change (after improving the extraction).
import { existsSync } from 'node:fs';
import { closePool } from '../lib/db.js';
import { runImport } from '../lib/importer.js';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && existsSync('.env.local')) process.loadEnvFile('.env.local');

const args = process.argv.slice(2);
try {
  const run = await runImport({ trigger: 'manual', force: args.includes('--force'), only: args.filter((a) => !a.startsWith('--')) });
  if ('skipped' in run) {
    process.exitCode = 1;
  } else {
    console.log(`Import ${run.status}${run.errors.length ? `:\n  ${run.errors.join('\n  ')}` : ''}`);
    if (run.status === 'failed') process.exitCode = 1;
  }
} catch (error) {
  console.error('Import failed:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
