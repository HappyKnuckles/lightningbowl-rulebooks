// GET /api/rulebooks/{id}/editions — every edition imported so far, newest first.
import { getEditions } from '../../../lib/catalog.js';
import { withCors } from '../../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../../lib/http.js';
import { sendJson, withErrorHandling } from '../../../lib/respond.js';
import { parseQuery, RulebookPath } from '../../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  const { id } = parseQuery(RulebookPath, req.query);
  sendJson(res, await getEditions(id));
}

export default withCors(withErrorHandling(handler));
