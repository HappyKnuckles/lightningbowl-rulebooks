// GET /api/rules?search= — finds rules across all rulebooks (or some), best match first.
import { searchRules } from '../lib/catalog.js';
import { withCors } from '../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../lib/http.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { parseQuery, RuleSearchQuery } from '../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  sendJson(res, await searchRules(parseQuery(RuleSearchQuery, req.query)), { maxAge: 600, staleWhileRevalidate: 3600 });
}

export default withCors(withErrorHandling(handler));
