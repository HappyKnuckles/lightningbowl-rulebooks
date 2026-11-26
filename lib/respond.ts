import type { ApiRequest, ApiResponse, Handler } from './http.js';
import { BadRequestError, NotFoundError } from './schemas.js';

/** JSON with CDN caching. Rulebooks change a few times a year, so caches may keep answers for a while. */
export function sendJson(res: ApiResponse, body: unknown, { maxAge = 3600, staleWhileRevalidate = 86400 } = {}): void {
  res.setHeader('Cache-Control', `public, max-age=300, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  res.status(200).json(body);
}

export function withErrorHandling(handler: Handler): Handler {
  return async (req: ApiRequest, res: ApiResponse) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (error instanceof BadRequestError) return res.status(400).json({ error: error.message });
      if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
      console.error('Handler error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
