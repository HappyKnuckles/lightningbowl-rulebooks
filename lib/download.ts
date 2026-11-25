// Finds a rulebook's current document and downloads it.
import { createHash } from 'node:crypto';
import type { Discovery, RulebookSource } from './sources.js';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Rulebooks are a few MB at most; anything bigger isn't one. */
const MAX_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const USER_AGENT = 'LightningBowlRulebooks/1.0 (+https://github.com/HappyKnuckles/lightningbowl-rulebooks)';

export interface Document {
  /** Where the document was downloaded from (after discovery). */
  url: string;
  bytes: Uint8Array;
  sha256: string;
  /** Last-Modified as an ISO date, if the server sent one. */
  lastModified: string | null;
}

/**
 * The document's URL: the link found on the official page when the rulebook has a `discover` rule,
 * otherwise (or when the page has no such link) the configured URL. Returns why discovery failed, if it did.
 */
export async function resolveUrl(source: RulebookSource, fetchFn: FetchFn = fetch): Promise<{ url: string; warning: string | null }> {
  if (!source.discover) return { url: source.url, warning: null };
  try {
    const response = await fetchFn(source.discover.page, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const url = pickLink(await response.text(), source.discover);
    if (url) return { url, warning: null };
    return { url: source.url, warning: `no link matching ${source.discover.link} on ${source.discover.page}` };
  } catch (error) {
    return { url: source.url, warning: `could not read ${source.discover.page}: ${(error as Error).message}` };
  }
}

/** The matching link on the page, as an absolute URL. */
export function pickLink(html: string, discovery: Discovery): string | null {
  const links: string[] = [];
  for (const [, href] of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const decoded = href!.replace(/&amp;/g, '&');
    if (!discovery.link.test(decoded)) continue;
    const absolute = new URL(decoded, discovery.page).href;
    if (!links.includes(absolute)) links.push(absolute);
  }
  if (links.length === 0) return null;
  if (discovery.pick !== 'highest') return links[0]!;
  return links.reduce((best, link) => (compareNumbers(fileName(link), fileName(best)) > 0 ? link : best));
}

const fileName = (url: string) => decodeURIComponent(url.split('/').pop() ?? url);

/** Compares the numbers in two strings in order ("2026-2027" > "2025-2026", "V13.2" > "V13.1"). */
function compareNumbers(a: string, b: string): number {
  const na = (a.match(/\d+/g) ?? []).map(Number);
  const nb = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const diff = (na[i] ?? -1) - (nb[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function download(url: string, fetchFn: FetchFn = fetch): Promise<Document> {
  const response = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error(`${url} is ${length} bytes, more than a rulebook`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error(`${url} is ${bytes.byteLength} bytes, more than a rulebook`);
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') === -1) throw new Error(`${url} is not a PDF`);
  const modified = response.headers.get('last-modified');
  const date = modified ? new Date(modified) : null;
  return {
    url,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    lastModified: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
  };
}
