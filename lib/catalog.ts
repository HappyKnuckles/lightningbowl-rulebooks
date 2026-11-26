// Queries behind the public endpoints: associations, rulebooks, their rules, and the search.
import { query } from './db.js';
import { escapeLike, pageOf, SqlParams } from './params.js';
import type { Association, Edition, Rule, RuleDetail, RuleHit, Rulebook, RulebookSummary, RuleSearchQuery } from './schemas.js';
import { NotFoundError } from './schemas.js';
import { ruleKey } from './structure.js';

type Timestamp = Date | string | null;
const iso = (value: Timestamp) => (value === null ? null : new Date(value).toISOString());

// ------------------------------------------------------------ rows → responses

interface EditionRow {
  edition_id: string | null;
  label: string | null;
  document_url: string | null;
  page_count: number | null;
  rule_count: number | null;
  structure: 'outline' | 'headings' | null;
  fetched_at: Timestamp;
}

interface RulebookRow extends EditionRow {
  id: string;
  association_id: string;
  title: string;
  language: 'en' | 'de';
  page_url: string;
  checked_at: Timestamp;
}

const EDITION_COLUMNS = `e.id::text AS edition_id, e.label, e.document_url, e.page_count, e.rule_count, e.structure, e.fetched_at`;
const RULEBOOK_COLUMNS = `r.id, r.association_id, r.title, r.language, r.page_url, r.checked_at, ${EDITION_COLUMNS}`;

function toEdition(row: EditionRow): Edition | null {
  if (!row.edition_id) return null;
  return {
    id: row.edition_id,
    label: row.label!,
    document_url: row.document_url!,
    page_count: row.page_count!,
    rule_count: row.rule_count!,
    structure: row.structure!,
    fetched_at: iso(row.fetched_at)!,
  };
}

function toRulebookSummary(row: RulebookRow): RulebookSummary {
  return {
    id: row.id,
    association_id: row.association_id,
    title: row.title,
    language: row.language,
    page_url: row.page_url,
    edition: toEdition(row),
    checked_at: iso(row.checked_at),
  };
}

interface RuleRow {
  key: string;
  number: string | null;
  title: string | null;
  level: number;
  parent_key: string | null;
  page: number;
}

const RULE_COLUMNS = 'ru.key, ru.number, ru.title, ru.level, ru.parent_key, ru.page';

/** The official document opened at the rule's page (PDF open parameter, understood by browsers' PDF viewers). */
const linkTo = (documentUrl: string, page: number) => `${documentUrl.split('#')[0]}#page=${page}`;

const toRule = (row: RuleRow, documentUrl: string): Rule => ({
  key: row.key,
  number: row.number,
  title: row.title,
  level: row.level,
  parent_key: row.parent_key,
  page: row.page,
  link: linkTo(documentUrl, row.page),
});

// ----------------------------------------------------------------- associations

/** Association ids for ids or former names (case-insensitive); unknown ones are left out. */
async function resolveAssociations(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const lower = names.map((n) => n.trim().toLowerCase());
  const { rows } = await query<{ id: string }>('SELECT id FROM associations WHERE removed_at IS NULL AND (id = ANY($1) OR aliases && $1)', [lower]);
  return rows.map((r) => r.id);
}

async function rulebooksOf(associationIds: string[] | null, language?: string): Promise<RulebookSummary[]> {
  const params = new SqlParams();
  const where = ['r.removed_at IS NULL'];
  if (associationIds) where.push(`r.association_id = ANY(${params.add(associationIds)})`);
  if (language) where.push(`r.language = ${params.add(language)}`);
  const { rows } = await query<RulebookRow>(
    `SELECT ${RULEBOOK_COLUMNS} FROM rulebooks r LEFT JOIN editions e ON e.id = r.current_edition_id
     WHERE ${where.join(' AND ')} ORDER BY r.association_id, r.title`,
    params.values,
  );
  return rows.map(toRulebookSummary);
}

interface AssociationRow {
  id: string;
  name: string;
  short_name: string;
  country: string | null;
  scope: Association['scope'];
  website: string;
  aliases: string[];
}

export async function findAssociations(filters: { search?: string; country?: string; scope?: string; language?: string }): Promise<Association[]> {
  const params = new SqlParams();
  const where = ['a.removed_at IS NULL'];
  if (filters.search) {
    const pattern = params.add(`%${escapeLike(filters.search)}%`);
    where.push(
      `(a.name ILIKE ${pattern} OR a.short_name ILIKE ${pattern} OR a.id ILIKE ${pattern} OR array_to_string(a.aliases, ' ') ILIKE ${pattern})`,
    );
  }
  if (filters.country) where.push(`a.country = ${params.add(filters.country)}`);
  if (filters.scope) where.push(`a.scope = ${params.add(filters.scope)}`);
  if (filters.language) {
    where.push(
      `EXISTS (SELECT 1 FROM rulebooks r WHERE r.association_id = a.id AND r.removed_at IS NULL AND r.language = ${params.add(filters.language)})`,
    );
  }
  const { rows } = await query<AssociationRow>(
    `SELECT id, name, short_name, country, scope, website, aliases FROM associations a WHERE ${where.join(' AND ')}
     ORDER BY CASE a.scope WHEN 'world' THEN 0 WHEN 'continental' THEN 1 WHEN 'national' THEN 2 ELSE 3 END, a.short_name`,
    params.values,
  );
  const rulebooks = await rulebooksOf(
    rows.map((r) => r.id),
    filters.language,
  );
  return rows.map((row) => ({ ...row, rulebooks: rulebooks.filter((r) => r.association_id === row.id) }));
}

export async function getAssociation(idOrAlias: string): Promise<Association> {
  const [id] = await resolveAssociations([idOrAlias]);
  if (!id) throw new NotFoundError(`Unknown association "${idOrAlias}"`);
  const { rows } = await query<AssociationRow>('SELECT id, name, short_name, country, scope, website, aliases FROM associations WHERE id = $1', [id]);
  return { ...rows[0]!, rulebooks: await rulebooksOf([id]) };
}

// -------------------------------------------------------------------- rulebooks

export async function findRulebooks(filters: { association: string[]; language?: string; search?: string }): Promise<RulebookSummary[]> {
  const ids = filters.association.length ? await resolveAssociations(filters.association) : null;
  if (ids && ids.length === 0) return [];
  const rulebooks = await rulebooksOf(ids, filters.language);
  const search = filters.search?.toLowerCase();
  return search ? rulebooks.filter((r) => r.title.toLowerCase().includes(search) || r.id.includes(search)) : rulebooks;
}

interface RulebookContext {
  summary: RulebookSummary;
  association: { id: string; name: string; short_name: string };
  /** The requested (or current) edition. */
  edition: Edition;
}

/** The rulebook with the requested edition (default: current). 404 for unknown rulebooks and editions. */
async function rulebookContext(id: string, editionId?: string): Promise<RulebookContext> {
  const { rows } = await query<RulebookRow & { a_name: string; a_short_name: string }>(
    `SELECT ${RULEBOOK_COLUMNS}, a.name AS a_name, a.short_name AS a_short_name
     FROM rulebooks r JOIN associations a ON a.id = r.association_id
     LEFT JOIN editions e ON e.id = ${editionId ? '$2::bigint AND e.rulebook_id = r.id' : 'r.current_edition_id'}
     WHERE r.id = $1 AND r.removed_at IS NULL`,
    editionId ? [id, editionId] : [id],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError(`Unknown rulebook "${id}"`);
  const summary = toRulebookSummary(row);
  if (!summary.edition) {
    throw new NotFoundError(editionId ? `Rulebook "${id}" has no edition ${editionId}` : `Rulebook "${id}" has not been imported yet`);
  }
  // `edition` on the summary is always the current one
  const current = editionId
    ? toRulebookSummary(
        (
          await query<RulebookRow>(
            `SELECT ${RULEBOOK_COLUMNS} FROM rulebooks r LEFT JOIN editions e ON e.id = r.current_edition_id WHERE r.id = $1`,
            [id],
          )
        ).rows[0]!,
      )
    : summary;
  return { summary: current, association: { id: row.association_id, name: row.a_name, short_name: row.a_short_name }, edition: summary.edition };
}

async function rulesOf(editionId: string): Promise<RuleRow[]> {
  const { rows } = await query<RuleRow>(`SELECT ${RULE_COLUMNS} FROM rules ru WHERE ru.edition_id = $1 ORDER BY ru.position`, [editionId]);
  return rows;
}

export async function getRulebook(id: string, options: { edition?: string; maxLevel?: number }): Promise<Rulebook & { edition_shown: Edition }> {
  const context = await rulebookContext(id, options.edition);
  const rules = (await rulesOf(context.edition.id)).filter((r) => !options.maxLevel || r.level <= options.maxLevel);
  return {
    ...context.summary,
    association: context.association,
    rules: rules.map((r) => toRule(r, context.edition.document_url)),
    edition_shown: context.edition,
  };
}

export async function getEditions(id: string): Promise<Edition[]> {
  await rulebookContext(id).catch((error) => {
    // a rulebook without editions yet has an empty history, not a 404
    if (!(error instanceof NotFoundError) || error.message.startsWith('Unknown')) throw error;
  });
  const { rows } = await query<EditionRow>(
    `SELECT ${EDITION_COLUMNS} FROM editions e WHERE e.rulebook_id = $1 ORDER BY e.fetched_at DESC, e.id DESC`,
    [id],
  );
  return rows.map((row) => toEdition(row)!);
}

export async function getRule(id: string, key: string, options: { edition?: string }): Promise<RuleDetail> {
  const context = await rulebookContext(id, options.edition);
  const rows = await rulesOf(context.edition.id);
  const wanted = ruleKey(key);
  const index = rows.findIndex((r) => r.key === wanted);
  if (index === -1) throw new NotFoundError(`Rulebook "${id}" has no rule "${key}"`);
  const row = rows[index]!;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const breadcrumbs: RuleRow[] = [];
  for (
    let parent = row.parent_key ? byKey.get(row.parent_key) : undefined;
    parent;
    parent = parent.parent_key ? byKey.get(parent.parent_key) : undefined
  ) {
    breadcrumbs.unshift(parent);
  }
  const url = context.edition.document_url;
  const rule = (r: RuleRow | undefined) => (r ? toRule(r, url) : null);
  return {
    ...toRule(row, url),
    rulebook: { id: context.summary.id, title: context.summary.title, language: context.summary.language },
    association: context.association,
    edition: context.edition,
    breadcrumbs: breadcrumbs.map((r) => toRule(r, url)),
    children: rows.filter((r) => r.parent_key === row.key).map((r) => toRule(r, url)),
    previous: rule(rows[index - 1]),
    next: rule(rows[index + 1]),
  };
}

// ----------------------------------------------------------------------- search

interface HitRow extends RuleRow {
  rulebook_id: string;
  rulebook_title: string;
  language: 'en' | 'de';
  association_id: string;
  association_name: string;
  association_short_name: string;
  edition_label: string;
  document_url: string;
  score: number;
  total: number;
}

/**
 * Rules of the current editions matching words (in titles and, through the search index, the rule
 * texts) or a rule number. Best first: an exact number, then rules containing all the words (in the title
 * before in the text), then titles that are merely similar (typos).
 */
export async function searchRules(q: RuleSearchQuery) {
  const params = new SqlParams();
  const text = params.add(q.search);
  const key = params.add(ruleKey(q.search));
  const like = params.add(`%${escapeLike(q.search)}%`);
  const config = `(CASE rb.language WHEN 'de' THEN 'german' ELSE 'english' END)::regconfig`;
  const tsquery = `websearch_to_tsquery(${config}, ${text})`;
  const where = [
    'rb.removed_at IS NULL',
    'a.removed_at IS NULL',
    `(ru.key = ${key} OR ru.search @@ ${tsquery} OR ru.title % ${text} OR ru.title ILIKE ${like})`,
  ];
  if (q.association.length) {
    const ids = await resolveAssociations(q.association);
    where.push(`rb.association_id = ANY(${params.add(ids)})`);
  }
  if (q.rulebook.length) where.push(`rb.id = ANY(${params.add(q.rulebook.map((r) => r.toLowerCase()))})`);
  if (q.language) where.push(`rb.language = ${params.add(q.language)}`);

  const size = params.add(q.size);
  const offset = params.add(q.page * q.size);
  const { rows } = await query<HitRow>(
    `SELECT ${RULE_COLUMNS}, rb.id AS rulebook_id, rb.title AS rulebook_title, rb.language,
            a.id AS association_id, a.name AS association_name, a.short_name AS association_short_name,
            e.label AS edition_label, e.document_url,
            ((CASE WHEN ru.key = ${key} THEN 10 ELSE 0 END)
              + (CASE WHEN ru.search @@ ${tsquery} THEN 1 + ts_rank(ru.search, ${tsquery}) ELSE 0 END)
              + 0.3 * coalesce(similarity(ru.title, ${text}), 0))::float8 AS score,
            count(*) OVER ()::int AS total
     FROM rules ru
     JOIN rulebooks rb ON rb.current_edition_id = ru.edition_id
     JOIN editions e ON e.id = ru.edition_id
     JOIN associations a ON a.id = rb.association_id
     WHERE ${where.join(' AND ')}
     ORDER BY score DESC, rb.id, ru.position
     LIMIT ${size} OFFSET ${offset}`,
    params.values,
  );

  const total = rows[0]?.total ?? (q.page > 0 ? await countOnly(where, params.values.slice(0, -2)) : 0);
  const content: RuleHit[] = rows.map((row) => ({
    ...toRule(row, row.document_url),
    rulebook: { id: row.rulebook_id, title: row.rulebook_title, language: row.language },
    association: { id: row.association_id, name: row.association_name, short_name: row.association_short_name },
    edition: row.edition_label,
    score: Math.round(row.score * 1000) / 1000,
  }));
  return pageOf(content, q, total);
}

/** The match count when the requested page is past the end (the window count has no row to ride on). */
async function countOnly(where: string[], values: unknown[]): Promise<number> {
  const { rows } = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM rules ru
     JOIN rulebooks rb ON rb.current_edition_id = ru.edition_id
     JOIN associations a ON a.id = rb.association_id
     WHERE ${where.join(' AND ')}`,
    values,
  );
  return rows[0]!.total;
}
