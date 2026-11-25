// GET /api/cron/import — called weekly by Vercel Cron (see vercel.json).
// Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is rejected.
import { requireSecret } from '../../lib/auth.js';
import type { ApiRequest, ApiResponse } from '../../lib/http.js';
import { runImport } from '../../lib/importer.js';

async function handler(_req: ApiRequest, res: ApiResponse) {
  try {
    const run = await runImport({ trigger: 'cron' });
    const status = 'skipped' in run ? 409 : run.status === 'failed' ? 502 : 200;
    res.status(status).json(run);
  } catch (error) {
    console.error('Import failed:', error);
    res.status(500).json({ error: 'Import failed' });
  }
}

export default requireSecret('CRON_SECRET', handler);
