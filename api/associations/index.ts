// GET /api/associations — associations with their rulebooks; optional search, country, scope, language.
import { findAssociations } from '../../lib/catalog.js';
import { withCors } from '../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../lib/http.js';
import { sendJson, withErrorHandling } from '../../lib/respond.js';
import { AssociationQuery, parseQuery } from '../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  sendJson(res, await findAssociations(parseQuery(AssociationQuery, req.query)));
}

export default withCors(withErrorHandling(handler));
