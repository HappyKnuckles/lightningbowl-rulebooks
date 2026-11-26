// Single source of truth for the API contract. Every request is validated with these schemas, the
// TypeScript types are inferred from them, and the OpenAPI document (lib/openapi.ts) is generated from
// them. Schemas with an `id` become reusable components in the OpenAPI document.

import { z } from 'zod';

// --------------------------------------------------------------- query parts

export const LANGUAGES = ['en', 'de'] as const;
export const SCOPES = ['national', 'continental', 'world', 'tour'] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const MAX_TEXT = 200;

const text = (description: string) => z.string().max(MAX_TEXT).optional().meta({ description });

const list = (description: string) =>
  z
    .array(z.string().max(MAX_TEXT))
    .max(50)
    .default([])
    .meta({ description: `${description} Repeat the parameter for several values.` });

const language = z.enum(LANGUAGES).optional().meta({ description: 'Language of the rulebook ("en" or "de").' });

export const pagingParams = {
  page: z.coerce.number().int().min(0).max(100_000).default(0).meta({ description: 'Zero-based page number.' }),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .meta({ description: `Page size (max ${MAX_PAGE_SIZE}).` }),
};

// ------------------------------------------------------------------ queries

export const AssociationQuery = z.object({
  search: text('Case-insensitive match on name, short name and former names. Alias: `q`.'),
  country: z.string().length(2).toUpperCase().optional().meta({ description: 'ISO 3166-1 alpha-2 country code, e.g. "DE".' }),
  scope: z.enum(SCOPES).optional().meta({ description: 'National associations, continental and world federations, or professional tours.' }),
  language,
});

export const AssociationPath = z.object({
  id: z.string().min(1).max(100).meta({ description: 'Association id, or one of its former names such as "world-bowling" or "etbf".' }),
});

export const RulebookQuery = z.object({
  association: list('Association id (or former name).'),
  language,
  search: text('Case-insensitive match on the title. Alias: `q`.'),
});

export const RulebookPath = z.object({ id: z.string().min(1).max(100).meta({ description: 'Rulebook id, e.g. "usbc-playing-rules".' }) });

const edition = z
  .string()
  .regex(/^\d{1,18}$/, { error: 'must be an edition id' })
  .optional()
  .meta({ description: 'Edition id (see `/rulebooks/{id}/editions`). Default: the current edition.' });

export const RulebookDetailQuery = z.object({
  edition,
  maxLevel: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .meta({ description: 'Only rules down to this level (1 = top level), for a short table of contents.' }),
});

export const RulePath = z.object({
  id: RulebookPath.shape.id,
  key: z.string().min(1).max(100).meta({ description: 'Rule key or number as printed: "4", "Rule 4", "§ 12", "3.1.2", "chapter-3".' }),
});

export const RuleQuery = z.object({ edition });

export const RuleSearchQuery = z.object({
  search: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TEXT)
    .meta({ description: 'Words to find in rule titles and texts, or a rule number. Alias: `q`. Required.' }),
  association: list('Association id (or former name).'),
  rulebook: list('Rulebook id.'),
  language,
  ...pagingParams,
});

export type RuleSearchQuery = z.output<typeof RuleSearchQuery>;

// ------------------------------------------------------------------ responses

const timestamp = (description: string) => z.iso.datetime({ offset: true }).meta({ description });

export const Edition = z
  .strictObject({
    id: z.string().meta({ description: 'Edition id (bigint as string).' }),
    label: z.string().meta({ description: 'As the document states it ("2026-2027", "01.07.2026", "Release 36"), else the file date.' }),
    document_url: z.string().meta({ description: 'The official document this edition was read from.' }),
    page_count: z.number().int(),
    rule_count: z.number().int(),
    structure: z.enum(['outline', 'headings']).meta({ description: 'Read from the PDF bookmarks, or from the numbered headings in the text.' }),
    fetched_at: timestamp('When this edition was first imported.'),
  })
  .meta({ id: 'Edition', description: 'One version of a rulebook document.' });

export const AssociationRef = z.strictObject({ id: z.string(), name: z.string(), short_name: z.string() }).meta({ id: 'AssociationRef' });

export const RulebookRef = z.strictObject({ id: z.string(), title: z.string(), language: z.enum(LANGUAGES) }).meta({ id: 'RulebookRef' });

export const RulebookSummary = z
  .strictObject({
    id: z.string(),
    association_id: z.string(),
    title: z.string(),
    language: z.enum(LANGUAGES),
    page_url: z.string().meta({ description: "The association's page for the rulebook." }),
    edition: Edition.nullable().meta({ description: 'The current edition, null until the first import succeeded.' }),
    checked_at: timestamp('Last import attempt.').nullable(),
  })
  .meta({ id: 'RulebookSummary' });

export const Association = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    short_name: z.string(),
    country: z.string().nullable().meta({ description: 'ISO 3166-1 alpha-2, null for continental and world federations.' }),
    scope: z.enum(SCOPES),
    website: z.string(),
    aliases: z.array(z.string()).meta({ description: 'Former names and other ids it is found by.' }),
    rulebooks: z.array(RulebookSummary),
  })
  .meta({ id: 'Association' });

export const Rule = z
  .strictObject({
    key: z.string().meta({ description: 'Identifies the rule in its rulebook, e.g. "4", "3.1.2", "chapter-3".' }),
    number: z.string().nullable().meta({ description: 'As printed, e.g. "Rule 4", "§ 12", "3.1.2"; null for unnumbered sections.' }),
    title: z.string().nullable().meta({ description: 'The heading; null for numbered paragraphs without one of their own.' }),
    level: z.number().int().meta({ description: '1 = top level.' }),
    parent_key: z.string().nullable(),
    page: z.number().int().meta({ description: 'Page in the document.' }),
    link: z.string().meta({ description: 'The official document opened at the page (`#page=`).' }),
  })
  .meta({ id: 'Rule', description: 'A rule or section: where it is, not what it says.' });

export const Rulebook = RulebookSummary.extend({
  association: AssociationRef,
  rules: z.array(Rule).meta({ description: 'Table of contents in document order; `level` and `parent_key` give the tree.' }),
}).meta({ id: 'Rulebook' });

export const RuleDetail = Rule.extend({
  rulebook: RulebookRef,
  association: AssociationRef,
  edition: Edition,
  breadcrumbs: z.array(Rule).meta({ description: 'The enclosing sections, top level first.' }),
  children: z.array(Rule),
  previous: Rule.nullable(),
  next: Rule.nullable(),
}).meta({ id: 'RuleDetail' });

export const RuleHit = Rule.extend({
  rulebook: RulebookRef,
  association: AssociationRef,
  edition: z.string().meta({ description: 'Edition label.' }),
  score: z.number(),
}).meta({ id: 'RuleHit' });

export const PageMeta = z
  .object({ number: z.number().int(), size: z.number().int(), totalElements: z.number().int(), totalPages: z.number().int() })
  .meta({ id: 'PageMeta' });

export const RuleHitPage = z
  .object({ content: z.array(RuleHit), page: PageMeta })
  .meta({ id: 'RuleHitPage', description: 'One page of search results, best first.' });

export type Edition = z.infer<typeof Edition>;
export type RulebookSummary = z.infer<typeof RulebookSummary>;
export type Association = z.infer<typeof Association>;
export type Rule = z.infer<typeof Rule>;
export type Rulebook = z.infer<typeof Rulebook>;
export type RuleDetail = z.infer<typeof RuleDetail>;
export type RuleHit = z.infer<typeof RuleHit>;

export const ImportRun = z
  .object({
    id: z.string().meta({ description: 'Run id (bigint as string).' }),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    status: z.enum(['running', 'success', 'partial', 'failed']),
    trigger: z.string(),
    stats: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Per rulebook: status (unchanged, imported, failed, not_reached), url, edition, rules.' }),
    errors: z.array(z.string()),
  })
  .meta({ id: 'ImportRun' });

export type ImportRun = z.infer<typeof ImportRun>;

export const Health = z
  .object({
    status: z.enum(['ok', 'empty']).meta({ description: '`empty`: tables exist but no import has run yet.' }),
    counts: z.object({
      associations: z.number().int(),
      rulebooks: z.number().int(),
      rulebooks_without_edition: z.number().int(),
      rules: z.number().int(),
    }),
    failing: z
      .array(z.object({ id: z.string(), error: z.string(), checked_at: z.string().nullable() }))
      .meta({ description: 'Rulebooks whose last import failed.' }),
    lastImport: ImportRun.nullable(),
  })
  .meta({ id: 'Health' });

export type Health = z.infer<typeof Health>;

export const NotInitialized = z
  .object({ status: z.literal('not_initialized'), hint: z.string() })
  .meta({ id: 'NotInitialized', description: 'The database has no tables yet; run the import once.' });

export const ApiError = z.object({ error: z.string() }).meta({ id: 'Error' });

// ------------------------------------------------------------ query parsing

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export type RawQuery = Record<string, string | string[] | undefined>;

type AnySchema = z.ZodType;

/** Unwraps optional/default/pipe wrappers to the schema that decides the shape. */
function baseOf(schema: AnySchema): AnySchema {
  const def = (schema as unknown as { def: { type: string; innerType?: AnySchema; in?: AnySchema } }).def;
  if ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable') && def.innerType) return baseOf(def.innerType);
  if (def.type === 'pipe' && def.in) return baseOf(def.in);
  return schema;
}

/**
 * Turns a raw query string object into what the schema expects:
 * - list parameters always become arrays (`?association=a` and `?association=a&association=b`), blank entries dropped;
 * - single parameters take the last value if repeated; blank means absent;
 * - enum values are matched case-insensitively to their canonical spelling;
 * - `q` is an alias for `search`;
 * - unknown parameters are ignored.
 */
export function normalizeQuery(schema: z.ZodObject, raw: RawQuery): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const value = key === 'search' ? (raw.search ?? raw.q) : raw[key];
    if (value === undefined) continue;
    const base = baseOf(fieldSchema as AnySchema);

    if (base instanceof z.ZodArray) {
      const values = (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
      if (values.length > 0) result[key] = values;
      continue;
    }

    const single = (Array.isArray(value) ? value[value.length - 1] : value)?.trim();
    if (!single) continue;

    if (base instanceof z.ZodEnum) {
      const options = base.options as string[];
      result[key] = options.find((option) => option.toLowerCase() === single.toLowerCase()) ?? single;
    } else {
      result[key] = single;
    }
  }
  return result;
}

/** Validates a query string; any problem becomes a 400 with a readable message. */
export function parseQuery<S extends z.ZodObject>(schema: S, raw: RawQuery): z.output<S> {
  const result = schema.safeParse(normalizeQuery(schema, raw));
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const name = String(issue.path[0] ?? 'query');
    const message =
      issue.code === 'invalid_type' && issue.input === undefined ? 'is required' : issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
    throw new BadRequestError(`Parameter "${name}" ${message}`);
  }
  return result.data;
}
