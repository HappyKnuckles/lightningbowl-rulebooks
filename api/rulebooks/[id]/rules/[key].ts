// GET /api/rulebooks/{id}/rules/{key} — one rule with where it sits: breadcrumbs, children, neighbours.
import { getRule } from '../../../../lib/catalog.js';
import { withCors } from '../../../../lib/cors.js';
import type { ApiRequest, ApiResponse } from '../../../../lib/http.js';
import { sendJson, withErrorHandling } from '../../../../lib/respond.js';
import { parseQuery, RulePath, RuleQuery } from '../../../../lib/schemas.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  const { id, key } = parseQuery(RulePath, req.query);
  sendJson(res, await getRule(id, key, parseQuery(RuleQuery, req.query)));
}

export default withCors(withErrorHandling(handler));
