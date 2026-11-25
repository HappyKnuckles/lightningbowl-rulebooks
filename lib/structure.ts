// Turns a rulebook PDF into its structure: the rules and sections with number, title, level and page.
// Pure functions over what lib/pdf.ts reads, so they are tested without PDFs.
//
// Two ways in: the PDF's bookmarks (outline) when it has enough of them, otherwise the heading lines in
// the text, recognised by their numbering ("Rule 4", "§ 12", "3.1.2", "4a.", "Chapter 3"). The text under
// each heading is only handed back for the search index; it is never stored or served.
import type { Line, OutlineEntry, PdfContent } from './pdf.js';

export interface HeadingPattern {
  /** Matched against a whole line. Named groups: `number` (as printed, e.g. "Rule 4", "§ 12", "3.1.2") and `title`. */
  pattern: RegExp;
  /** Level of such a heading, or a function of its number. Levels are relative: the smallest found becomes 1. */
  level: number | ((number: string) => number);
  /** In the text, only lines printed larger than the body text count (for patterns that body lines could match too). Bookmarks always count. */
  larger?: boolean;
}

export interface ExtractedRule {
  /** Identifies the rule within its edition, derived from the number (or the title): "4", "3.1.2", "chapter-3". */
  key: string;
  /** As printed, e.g. "Rule 4", "§ 12", "3.1.2"; null for unnumbered sections like a glossary. */
  number: string | null;
  /** Null for numbered paragraphs that have no heading of their own (their first words are rule text, which isn't kept). */
  title: string | null;
  /** 1 = top level. */
  level: number;
  /** Key of the enclosing rule, null at the top. */
  parentKey: string | null;
  /** 1-based page in the PDF. */
  page: number;
  /** Text under the heading, for the search index only. */
  body: string;
}

export interface Structure {
  source: 'outline' | 'headings';
  rules: ExtractedRule[];
}

const depth = (number: string) => number.split('.').length;

/** Patterns that cover how most rulebooks number their rules. A rulebook's own patterns are tried first. */
export const DEFAULT_HEADINGS: HeadingPattern[] = [
  {
    pattern: /^(?<number>(?:Chapter|Part|Kapitel|Teil|Abschnitt)\s+(?:\d{1,3}|[IVXLC]{1,6}|[A-Z]))\s*[:.–—-]?\s+(?<title>\S.*)$/iu,
    level: 1,
  },
  { pattern: /^(?<number>(?:Rule|Regel|Article|Artikel|Art\.)\s*\d{1,4}[a-z]?)\s*[:.–—-]?\s+(?<title>\S.*)$/iu, level: 2 },
  { pattern: /^(?<number>§\s*\d{1,4}[a-z]?)\.?\s*[:.–—-]?\s*(?<title>\p{L}.*)$/u, level: 2 },
  { pattern: /^(?<number>\d{1,3}(?:\.\d{1,3}){1,4})\.?\s+(?<title>\p{Lu}.*)$/u, level: (number) => depth(number) + 1 },
  { pattern: /^(?<number>\d{1,3}[a-z])(?:[.)]|\s*[–—-])?\s*(?<title>\p{Lu}.*)$/u, level: 3 },
  // "3 Spielbetrieb": a chapter by a plain number, only recognisable by its size
  { pattern: /^(?<number>\d{1,2})\.?\s+(?<title>\p{Lu}.{1,80})$/u, level: 2, larger: true },
];

/** Bookmarks that are not part of the rules. */
const NOT_A_SECTION = /^(?:contents|table of contents|inhalt|inhaltsverzeichnis|index)$/iu;

/** A heading's number alone on its line, with the title on the next one. */
const NUMBER_ONLY = /^(?:(?:Chapter|Part|Kapitel|Teil|Abschnitt|Rule|Regel|Article|Artikel)\s+\S{1,6}|§\s*\d{1,4}[a-z]?)$/iu;

/** Table of contents entries end in the page number, often after leader dots. */
const LEADER_AND_PAGE = /\s*(?:[.·…_]\s?){2,}\s*\d{1,4}$/u;
const TRAILING_PAGE = /\s\d{1,4}$/;

const MAX_TITLE = 120;
/** Bookmarks are used when there are at least this many; numbered headings in the text that they lack are added. */
const MIN_OUTLINE = 3;
/** Text kept per rule for the search index. */
const MAX_BODY = 20_000;

interface Candidate {
  number: string | null;
  title: string | null;
  level: number;
  page: number;
  line: number;
}

export function extractStructure(content: PdfContent, options: { headings?: HeadingPattern[]; ignoreOutline?: boolean } = {}): Structure {
  const patterns = [...(options.headings ?? []), ...DEFAULT_HEADINGS];
  const fromText = findHeadings(content.pages, patterns);
  const outline = options.ignoreOutline ? [] : content.outline.filter((entry) => entry.page !== null && entry.title);
  if (outline.length < MIN_OUTLINE) return { source: 'headings', rules: finish(fromText, content.pages) };
  return { source: 'outline', rules: finish(mergeOutline(fromOutline(outline, content.pages, patterns), fromText), content.pages) };
}

/** Heading lines in the text, without the table of contents and repeats. */
export function findHeadings(pages: Line[][], patterns: HeadingPattern[]): Candidate[] {
  const bodySize = medianSize(pages);
  const found: Candidate[] = [];

  pages.forEach((lines, pageIndex) => {
    const onPage: (Candidate & { toc: boolean })[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.size < bodySize - 0.5) continue; // smaller than the body text: footnotes, footers
      let text = line.text;
      const next = lines[i + 1];
      if (NUMBER_ONLY.test(text) && next) text = `${text} ${next.text}`;
      const match = matchHeading(text, patterns, line.size > bodySize * 1.1);
      if (!match) continue;
      // a title that runs on into the next line is the start of a sentence
      if (match.title && next && /^\p{Ll}/u.test(next.text) && !NUMBER_ONLY.test(text)) match.title = null;
      onPage.push({ ...match, page: pageIndex + 1, line: i });
    }
    // a table of contents: mostly entries ending in page numbers, or (without page numbers) almost only headings
    const tocEntries = onPage.filter((c) => c.toc).length;
    if (tocEntries >= 3 && tocEntries * 2 >= onPage.length) return;
    if (onPage.length >= 8 && onPage.length >= lines.length * 0.7) return;
    found.push(...onPage.filter((c) => !c.toc).map(({ toc: _, ...candidate }) => candidate));
  });

  // a table of contents without page numbers: a page whose headings mostly come again later
  const id = (c: Candidate) => ruleKey(c.number!);
  const lastPage = new Map<string, number>();
  for (const c of found) lastPage.set(id(c), c.page);
  const tocPages = new Set<number>();
  for (const page of new Set(found.map((c) => c.page))) {
    const onPage = found.filter((c) => c.page === page);
    const again = onPage.filter((c) => lastPage.get(id(c))! > page).length;
    if (onPage.length >= 3 && again >= onPage.length * 0.6) tocPages.add(page);
  }

  // the same number twice: cross references or running headers; the first is the heading
  const seen = new Set<string>();
  return found.filter((candidate) => {
    if (tocPages.has(candidate.page)) return false;
    if (seen.has(id(candidate))) return false;
    seen.add(id(candidate));
    return true;
  });
}

/**
 * Number, title and level of a heading line, or null if the line isn't one. A numbered paragraph (the
 * number followed by rule text rather than a heading) gets a null title, or the label before its colon
 * ("4.1 Breitensportturniere: An einem …" → "Breitensportturniere").
 */
export function matchHeading(
  text: string,
  patterns: HeadingPattern[],
  larger = true,
): { number: string; title: string | null; level: number; toc: boolean } | null {
  for (const { pattern, level, larger: needsLarger } of patterns) {
    if (needsLarger && !larger) continue;
    const groups = pattern.exec(text)?.groups;
    if (!groups?.number || groups.title === undefined) continue;
    const number = groups.number.replace(/\s+/g, ' ').trim();
    let title = groups.title.trim();
    const toc = LEADER_AND_PAGE.test(title) || TRAILING_PAGE.test(title);
    title = title.replace(LEADER_AND_PAGE, '').replace(/^[:.–—-]\s*/, '').trim();
    if (!title || !/\p{L}/u.test(title)) continue;
    return { number, title: headingTitle(title), level: typeof level === 'function' ? level(number) : level, toc };
  }
  return null;
}

/** Words that make a line a sentence rather than a heading. */
const VERBS =
  /\s(?:is|are|was|were|be|been|shall|must|may|will|can|cannot|should|has|have|ist|sind|wird|werden|wurde|muss|müssen|kann|können|darf|dürfen|soll|sollen|hat|haben|gilt|gelten|erhält|regelt|besteht|bestehen)\s/iu;
const MAX_WORDS = 12;

/** The heading in `text`, or null if it is the start of rule text. */
export function headingTitle(text: string): string | null {
  const colon = /^([^:]{2,40}):\s+\S/u.exec(text);
  if (colon && isHeading(colon[1]!)) return colon[1]!.trim();
  return isHeading(text) ? text : null;
}

function isHeading(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return text.length <= MAX_TITLE && words.length > 0 && words.length <= MAX_WORDS && !/[.:,;]$/.test(text) && !VERBS.test(` ${text} `);
}

/** Bookmarks as candidates, placed on the line of their page where the heading is printed. */
function fromOutline(outline: OutlineEntry[], pages: Line[][], patterns: HeadingPattern[]): Candidate[] {
  const candidates = outline.flatMap((entry) => {
    const heading = matchHeading(entry.title, patterns);
    // a bookmark on a sentence (some PDFs bookmark body text) is no heading, nor is the table of contents
    if (!heading && (!headingTitle(entry.title) || NOT_A_SECTION.test(entry.title))) return [];
    const page = entry.page!;
    const wanted = normalize(entry.title).slice(0, 24);
    const line = Math.max(0, (pages[page - 1] ?? []).findIndex((l) => normalize(l.text).includes(wanted)));
    return [
      heading
        ? { number: heading.number, title: heading.title, level: entry.level, page, line }
        : { number: null, title: entry.title, level: entry.level, page, line },
    ];
  });
  // "CHAPTER 1" with "CHAPTER 1 GENERAL PLAYING RULES" right under it: one entry, with the title
  return candidates.filter((candidate, i) => {
    const next = candidates[i + 1];
    const same = next && candidate.number && next.number && ruleKey(candidate.number) === ruleKey(next.number);
    if (same && (!candidate.title || candidate.title.length <= next.title!.length)) {
      next.level = candidate.level;
      return false;
    }
    return true;
  });
}

/**
 * Bookmarks plus the numbered headings and paragraphs of the text that have no bookmark, in document
 * order. Those added go one level below the nearest preceding entry their number continues ("2.1" → "2.1.3",
 * "4" → "4a"), or below the preceding bookmark.
 */
function mergeOutline(outline: Candidate[], text: Candidate[]): Candidate[] {
  const id = (c: Candidate) => (c.number ? ruleKey(c.number) : null);
  const known = new Set(outline.map(id).filter(Boolean));
  const merged = [...outline, ...text.filter((c) => !known.has(id(c)))].sort((a, b) => a.page - b.page || a.line - b.line);
  const placed: Candidate[] = [];
  for (const candidate of merged) {
    if (outline.includes(candidate)) {
      placed.push(candidate);
      continue;
    }
    const key = id(candidate)!;
    const parent = [...placed].reverse().find((p) => {
      const parentKey = id(p);
      return parentKey && key !== parentKey && key.startsWith(parentKey) && /^[.a-z]/.test(key.slice(parentKey.length));
    });
    const anchor = parent ?? [...placed].reverse().find((p) => outline.includes(p));
    placed.push({ ...candidate, level: (anchor?.level ?? 0) + 1 });
  }
  return placed;
}

/** Levels starting at 1, parents, unique keys and the text under each heading. */
function finish(candidates: Candidate[], pages: Line[][]): ExtractedRule[] {
  const minLevel = Math.min(...candidates.map((c) => c.level));
  const repeated = repeatedLines(pages);
  const used = new Map<string, number>();
  const stack: ExtractedRule[] = [];

  return candidates.map((candidate, index) => {
    const level = candidate.level - minLevel + 1;
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const base = ruleKey(candidate.number ?? candidate.title ?? 'section');
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const next = candidates[index + 1];
    const rule: ExtractedRule = {
      key: count === 1 ? base : `${base}-${count}`,
      number: candidate.number,
      title: candidate.title,
      level,
      parentKey: stack[stack.length - 1]?.key ?? null,
      page: candidate.page,
      body: bodyBetween(pages, candidate, next, repeated),
    };
    stack.push(rule);
    return rule;
  });
}

function bodyBetween(pages: Line[][], from: Candidate, to: Candidate | undefined, repeated: Set<string>): string {
  const parts: string[] = [];
  let length = 0;
  for (let page = from.page; page <= (to?.page ?? pages.length) && length < MAX_BODY; page++) {
    const lines = pages[page - 1] ?? [];
    const start = page === from.page ? from.line + 1 : 0;
    const end = to && page === to.page ? to.line : lines.length;
    for (let i = start; i < end && length < MAX_BODY; i++) {
      const text = lines[i]!.text;
      if (repeated.has(normalize(text))) continue;
      parts.push(text);
      length += text.length + 1;
    }
  }
  return parts.join(' ').slice(0, MAX_BODY);
}

/** Running headers and footers: lines (digits ignored) on at least a third of the pages. */
function repeatedLines(pages: Line[][]): Set<string> {
  const min = Math.max(3, Math.ceil(pages.length / 3));
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const text of new Set(lines.map((l) => normalize(l.text).replace(/\d+/g, '#')))) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const repeated = new Set<string>();
  for (const lines of pages) {
    for (const line of lines) {
      const text = normalize(line.text);
      if ((counts.get(text.replace(/\d+/g, '#')) ?? 0) >= min) repeated.add(text);
    }
  }
  return repeated;
}

function medianSize(pages: Line[][]): number {
  const sizes = pages
    .flat()
    .map((l) => l.size)
    .sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The key a rule is looked up by: the number without words like "Rule" or "§" ("Rule 4" → "4", "§ 12a" →
 * "12a", "3.1.2" stays), "chapter-3" for chapters and parts, and a slug of the title for unnumbered sections.
 * Also applied to keys in requests, so "Rule 4", "§12a" and "4" find their rule.
 */
export function ruleKey(numberOrTitle: string): string {
  const text = numberOrTitle.trim().toLowerCase();
  const bare = /^(?:rule|regel|article|artikel|art\.|§)\s*(\d{1,4}[a-z]?)$/u.exec(text);
  if (bare) return bare[1]!;
  if (/^\d{1,3}(?:\.\d{1,3})*[a-z]?\.?$/.test(text)) return text.replace(/\.$/, '');
  return (
    text
      .normalize('NFKD')
      .replace(/ß/g, 'ss')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section'
  );
}

/** The edition label in the document's file name or its first pages, by the rulebook's pattern (capture group 1). */
export function findEdition(pattern: RegExp | undefined, pages: Line[][], url: string): string | null {
  if (!pattern) return null;
  const text = pages
    .slice(0, 3)
    .flat()
    .map((l) => l.text)
    .join('\n');
  const match = pattern.exec(decodeURIComponent(url.split('/').pop() ?? '')) ?? pattern.exec(text);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}
