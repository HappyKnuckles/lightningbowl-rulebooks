// Weekly import: writes the associations and rulebooks from lib/sources.ts to the database, downloads
// each rulebook's current document and, when it is a new one (by SHA-256), stores its structure as a
// new edition and makes it current.
//
// - A rulebook whose document didn't change is only marked as checked.
// - A rulebook that fails (download, unreadable PDF, no rules found) keeps its current edition; the
//   error is kept on the rulebook and in the run. One failing rulebook doesn't stop the others.
// - Runs are logged in `import_runs`; overlapping runs are skipped.
import { query, withTransaction } from './db.js';
import { download, type FetchFn, resolveUrl } from './download.js';
import { migrate } from './migrate.js';
import { readPdf } from './pdf.js';
import type { ImportRun } from './schemas.js';
import { ASSOCIATIONS, type AssociationSource, type Language, type RulebookSource } from './sources.js';
import { extractStructure, findEdition } from './structure.js';

const STALE_RUN_MS = 30 * 60 * 1000;
/** The cron function may run 300 s; no rulebook is started after this point of the run. */
const DEADLINE_MS = 240 * 1000;
const BATCH_SIZE = 500;

/** Postgres text search configuration per rulebook language. */
export const SEARCH_CONFIG: Record<Language, string> = { en: 'english', de: 'german' };

export interface ImportOptions {
  trigger?: string;
  associations?: AssociationSource[];
  /** Only these rulebook (or association) ids. */
  only?: string[];
  /** Re-read documents even if they didn't change (after improving the extraction). */
  force?: boolean;
  fetchFn?: FetchFn;
  deadlineMs?: number;
  log?: (message: string) => void;
}

export interface RulebookResult {
  status: 'unchanged' | 'imported' | 'failed' | 'not_reached';
  url?: string;
  edition?: string;
  rules?: number;
  structure?: 'outline' | 'headings';
  warning?: string;
}

export async function runImport({
  trigger = 'manual',
  associations = ASSOCIATIONS,
  only,
  force = false,
  fetchFn = fetch,
  deadlineMs = DEADLINE_MS,
  log = console.log,
}: ImportOptions = {}): Promise<ImportRun | { skipped: true }> {
  const started = Date.now();
  await migrate({ log });

  await query(
    `UPDATE import_runs SET status = 'failed', finished_at = now(), errors = errors || '{"did not finish"}'
     WHERE status = 'running' AND started_at < now() - $1::interval`,
    [`${STALE_RUN_MS} milliseconds`],
  );
  const { rows: created } = await query<{ id: string }>(
    `INSERT INTO import_runs (trigger) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM import_runs WHERE status = 'running') RETURNING id`,
    [trigger],
  );
  if (!created[0]) {
    log('Another import is running; skipped');
    return { skipped: true };
  }
  const runId = created[0].id;

  const stats: Record<string, RulebookResult> = {};
  const errors: string[] = [];
  try {
    await writeCatalog(associations);
    const rulebooks = associations
      .flatMap((a) => a.rulebooks.map((r) => ({ ...r, associationId: a.id })))
      .filter((r) => !only?.length || only.includes(r.id) || only.includes(r.associationId));

    for (const rulebook of rulebooks) {
      if (Date.now() - started > deadlineMs) {
        stats[rulebook.id] = { status: 'not_reached' };
        errors.push(`${rulebook.id}: not reached before the deadline`);
        continue;
      }
      try {
        stats[rulebook.id] = await importRulebook(rulebook, { force, fetchFn });
        const result = stats[rulebook.id]!;
        log(
          `${rulebook.id}: ${result.status}${result.rules !== undefined ? `, ${result.rules} rules` : ''}${result.warning ? ` (${result.warning})` : ''}`,
        );
      } catch (error) {
        const message = (error as Error).message;
        stats[rulebook.id] = { status: 'failed' };
        errors.push(`${rulebook.id}: ${message}`);
        log(`${rulebook.id}: failed: ${message}`);
        await query('UPDATE rulebooks SET checked_at = now(), check_error = $2 WHERE id = $1', [rulebook.id, message]);
      }
    }
  } catch (error) {
    errors.push((error as Error).message);
  }

  const results = Object.values(stats);
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'not_reached').length;
  const status = errors.length === 0 ? 'success' : failed === results.length ? 'failed' : 'partial';
  const { rows } = await query<ImportRun>(
    `UPDATE import_runs SET status = $2, finished_at = now(), stats = $3::jsonb, errors = $4
     WHERE id = $1 RETURNING id::text, started_at, finished_at, status, trigger, stats, errors`,
    [runId, status, JSON.stringify(stats), errors],
  );
  return rows[0]!;
}

/** Associations and rulebooks as configured; ones no longer configured are marked removed. */
async function writeCatalog(associations: AssociationSource[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const a of associations) {
      await client.query(
        `INSERT INTO associations (id, name, short_name, country, scope, website, aliases, removed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
         ON CONFLICT (id) DO UPDATE SET name = $2, short_name = $3, country = $4, scope = $5, website = $6, aliases = $7, removed_at = NULL`,
        [a.id, a.name, a.shortName, a.country, a.scope, a.website, a.aliases],
      );
      for (const r of a.rulebooks) {
        await client.query(
          `INSERT INTO rulebooks (id, association_id, title, language, page_url, removed_at)
           VALUES ($1, $2, $3, $4, $5, NULL)
           ON CONFLICT (id) DO UPDATE SET association_id = $2, title = $3, language = $4, page_url = $5, removed_at = NULL`,
          [r.id, a.id, r.title, r.language, r.page],
        );
      }
    }
    const associationIds = associations.map((a) => a.id);
    const rulebookIds = associations.flatMap((a) => a.rulebooks.map((r) => r.id));
    await client.query('UPDATE associations SET removed_at = now() WHERE removed_at IS NULL AND NOT (id = ANY($1))', [associationIds]);
    await client.query('UPDATE rulebooks SET removed_at = now() WHERE removed_at IS NULL AND NOT (id = ANY($1))', [rulebookIds]);
  });
}

async function importRulebook(source: RulebookSource, { force, fetchFn }: { force: boolean; fetchFn: FetchFn }): Promise<RulebookResult> {
  const { url, warning } = await resolveUrl(source, fetchFn);
  const document = await download(url, fetchFn);

  const { rows: known } = await query<{ id: string; label: string; rule_count: number; structure: 'outline' | 'headings' }>(
    'SELECT id::text, label, rule_count, structure FROM editions WHERE rulebook_id = $1 AND sha256 = $2',
    [source.id, document.sha256],
  );
  const existing = known[0];
  if (existing && !force) {
    // the same document as before (or as an older edition the association went back to)
    await query('UPDATE rulebooks SET current_edition_id = $2, checked_at = now(), check_error = NULL WHERE id = $1', [source.id, existing.id]);
    return {
      status: 'unchanged',
      url,
      edition: existing.label,
      rules: existing.rule_count,
      structure: existing.structure,
      ...(warning ? { warning } : {}),
    };
  }

  const content = await readPdf(document.bytes);
  const structure = extractStructure(content, source);
  if (structure.rules.length === 0) throw new Error(`no rules found in ${url}`);
  const label = findEdition(source.edition, content.pages, url) ?? document.lastModified ?? new Date().toISOString().slice(0, 10);
  const config = SEARCH_CONFIG[source.language];

  await withTransaction(async (client) => {
    if (existing)
      await client.query('UPDATE rulebooks SET current_edition_id = NULL WHERE id = $1 AND current_edition_id = $2', [source.id, existing.id]);
    if (existing) await client.query('DELETE FROM editions WHERE id = $1', [existing.id]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO editions (rulebook_id, label, document_url, sha256, page_count, rule_count, structure)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
      [source.id, label, url, document.sha256, content.pageCount, structure.rules.length, structure.source],
    );
    const editionId = rows[0]!.id;
    for (let start = 0; start < structure.rules.length; start += BATCH_SIZE) {
      const batch = structure.rules.slice(start, start + BATCH_SIZE);
      await client.query(
        `INSERT INTO rules (edition_id, key, number, title, level, parent_key, page, position, search)
         SELECT $1, u.key, u.number, u.title, u.level, u.parent_key, u.page, u.position,
                setweight(to_tsvector('simple', coalesce(u.number, '')), 'A')
                || setweight(to_tsvector($2::regconfig, coalesce(u.title, '')), 'A')
                || setweight(to_tsvector($2::regconfig, u.body), 'C')
         FROM unnest($3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::int[], $9::int[], $10::text[])
           AS u(key, number, title, level, parent_key, page, position, body)`,
        [
          editionId,
          config,
          batch.map((r) => r.key),
          batch.map((r) => r.number),
          batch.map((r) => r.title),
          batch.map((r) => r.level),
          batch.map((r) => r.parentKey),
          batch.map((r) => r.page),
          batch.map((_, i) => start + i),
          batch.map((r) => r.body),
        ],
      );
    }
    await client.query('UPDATE rulebooks SET current_edition_id = $2, checked_at = now(), check_error = NULL WHERE id = $1', [source.id, editionId]);
  });

  return { status: 'imported', url, edition: label, rules: structure.rules.length, structure: structure.source, ...(warning ? { warning } : {}) };
}
