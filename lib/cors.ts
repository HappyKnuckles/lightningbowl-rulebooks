// Public, read-only API: any origin may read it (no credentials), with a per-IP rate limit, security
// headers, and only GET and OPTIONS.
import type { ApiRequest, ApiResponse, Handler } from './http.js';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 100 };
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// unref() lets Node test runs exit; optional because other runtimes return a plain number here.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now - value.resetTime > RATE_LIMIT.windowMs) rateLimitStore.delete(key);
  }
}, 300_000);
cleanupTimer?.unref?.();

function rateLimit(req: ApiRequest, res: ApiResponse): boolean {
  const forwarded = req.headers['x-forwarded-for'];
  const clientId = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const client = rateLimitStore.get(clientId);

  if (!client || now - client.resetTime > RATE_LIMIT.windowMs) {
    rateLimitStore.set(clientId, { count: 1, resetTime: now });
    return true;
  }
  if (client.count >= RATE_LIMIT.maxRequests) {
    const retryAfter = Math.ceil((RATE_LIMIT.windowMs - (now - client.resetTime)) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return false;
  }
  client.count++;
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.maxRequests);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT.maxRequests - client.count);
  return true;
}

export function withCors(handler: Handler): Handler {
  return async (req: ApiRequest, res: ApiResponse) => {
    if (!rateLimit(req, res)) return;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return handler(req, res);
  };
}
