// GET /api/associations/{id} — one association (by id or former name) with its rulebooks.
import { getAssociation } from '../../lib/catalog.js';
import { withCors } from '../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../lib/http.js';
import { sendJson, withErrorHandling } from '../../lib/respond.js';
import { AssociationPath, parseQuery } from '../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  const { id } = parseQuery(AssociationPath, req.query);
  sendJson(res, await getAssociation(id));
}

export default withCors(withErrorHandling(handler));
