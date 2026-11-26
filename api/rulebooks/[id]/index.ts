// GET /api/rulebooks/{id} — the rulebook with its table of contents (current edition, or `edition`).
import { getRulebook } from '../../../lib/catalog.js';
import { withCors } from '../../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../../lib/http.js';
import { sendJson, withErrorHandling } from '../../../lib/respond.js';
import { parseQuery, RulebookDetailQuery, RulebookPath } from '../../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  const { id } = parseQuery(RulebookPath, req.query);
  const { edition_shown: _, ...rulebook } = await getRulebook(id, parseQuery(RulebookDetailQuery, req.query));
  sendJson(res, rulebook);
}

export default withCors(withErrorHandling(handler));
