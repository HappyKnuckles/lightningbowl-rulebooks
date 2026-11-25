// GET /api/rulebooks — rulebooks with their current edition; optional association, language, search.
import { findRulebooks } from '../../lib/catalog.js';
import { withCors } from '../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../lib/http.js';
import { sendJson, withErrorHandling } from '../../lib/respond.js';
import { parseQuery, RulebookQuery } from '../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  sendJson(res, await findRulebooks(parseQuery(RulebookQuery, req.query)));
}

export default withCors(withErrorHandling(handler));
