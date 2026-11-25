// GET /api/health — what is imported, which rulebooks fail, and the latest import run. Needs ADMIN_SECRET.
import { requireSecret } from '../lib/auth.js';
import { withCors } from '../lib/cors.js';
import { query } from '../lib/db.js';
import type { ApiRequest, ApiResponse } from '../lib/http.js';
import { withErrorHandling } from '../lib/respond.js';
import type { Health, ImportRun } from '../lib/schemas.js';

async function handler(_req: ApiRequest, res: ApiResponse) {
  try {
    await query('SELECT 1 FROM rulebooks LIMIT 1');
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') {
      // undefined_table: migrations haven't run yet
      return res.status(503).json({
        status: 'not_initialized',
        hint: 'Run the import once (Vercel → Settings → Cron Jobs → Run); it creates the tables and imports the rulebooks.',
      });
    }
    throw error;
  }

  const [{ rows: counts }, { rows: failing }, { rows: runs }] = await Promise.all([
    query<Health['counts']>(`SELECT
      (SELECT count(*)::int FROM associations WHERE removed_at IS NULL) AS associations,
      (SELECT count(*)::int FROM rulebooks WHERE removed_at IS NULL) AS rulebooks,
      (SELECT count(*)::int FROM rulebooks WHERE removed_at IS NULL AND current_edition_id IS NULL) AS rulebooks_without_edition,
      (SELECT count(*)::int FROM rules ru JOIN rulebooks r ON r.current_edition_id = ru.edition_id WHERE r.removed_at IS NULL) AS rules`),
    query<Health['failing'][number]>(
      `SELECT id, check_error AS error, to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS checked_at
       FROM rulebooks WHERE removed_at IS NULL AND check_error IS NOT NULL ORDER BY id`,
    ),
    query<ImportRun>(`SELECT id::text, started_at, finished_at, status, trigger, stats, errors FROM import_runs ORDER BY started_at DESC LIMIT 1`),
  ]);

  const body: Health = { status: runs[0] ? 'ok' : 'empty', counts: counts[0]!, failing, lastImport: runs[0] ?? null };
  res.status(200).json(body);
}

export default withCors(requireSecret('ADMIN_SECRET', withErrorHandling(handler)));
