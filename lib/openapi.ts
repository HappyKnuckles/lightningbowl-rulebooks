// Builds the OpenAPI 3.1 document from the Zod schemas in schemas.ts, so the docs can't drift from
// what the handlers validate and return.
import { z } from 'zod';
import {
  ApiError,
  Association,
  AssociationPath,
  AssociationQuery,
  AssociationRef,
  Edition,
  Health,
  ImportRun,
  NotInitialized,
  PageMeta,
  Rule,
  Rulebook,
  RulebookDetailQuery,
  RulebookPath,
  RulebookQuery,
  RulebookRef,
  RulebookSummary,
  RuleDetail,
  RuleHit,
  RuleHitPage,
  RulePath,
  RuleQuery,
  RuleSearchQuery,
} from './schemas.js';

type JsonSchema = Record<string, unknown>;

const COMPONENTS = [
  Association,
  AssociationRef,
  RulebookSummary,
  RulebookRef,
  Rulebook,
  Edition,
  Rule,
  RuleDetail,
  RuleHit,
  RuleHitPage,
  PageMeta,
  Health,
  ImportRun,
  NotInitialized,
  ApiError,
];

const ref = (schema: z.ZodType): JsonSchema => {
  const id = z.globalRegistry.get(schema)?.id;
  if (!id) throw new Error('Schema has no id');
  return { $ref: `#/components/schemas/${id}` };
};

const json = (schema: JsonSchema, description: string) => ({ description, content: { 'application/json': { schema } } });

const errors = {
  '400': json(ref(ApiError), 'Invalid parameter.'),
  '429': json(ref(ApiError), 'Rate limit exceeded (100 requests per minute per IP).'),
  '500': json(ref(ApiError), 'Server error.'),
};
const notFound = (what: string) => ({ '404': json(ref(ApiError), what) });

/** Turns a query (or path) object schema into OpenAPI parameter objects. */
function parameters(schema: z.ZodObject, location: 'query' | 'path' = 'query') {
  return Object.entries(schema.shape).map(([name, field]) => {
    const { $schema: _, description, ...fieldSchema } = z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
    const isArray = fieldSchema.type === 'array';
    const required = location === 'path' || (schema === RuleSearchQuery && name === 'search');
    return {
      name,
      in: location,
      required,
      ...(description ? { description } : {}),
      schema: fieldSchema,
      ...(isArray ? { style: 'form', explode: true } : {}),
    };
  });
}

const unauthorized = { '401': json(ref(ApiError), 'Missing or wrong secret.') };

const get = (operationId: string, summary: string, operation: Record<string, unknown>) => ({
  // Public unless the operation says otherwise.
  get: { operationId, summary, security: [], ...operation },
});

export function buildOpenApi(): JsonSchema {
  const { schemas } = z.toJSONSchema(z.globalRegistry, { uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, JsonSchema> };
  const components: Record<string, JsonSchema> = {};
  for (const schema of COMPONENTS) {
    const id = z.globalRegistry.get(schema)!.id!;
    const { $schema: _, $id: __, ...rest } = schemas[id]!;
    components[id] = rest;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Lightning Bowl Rulebooks API',
      version: '1.0.0',
      license: { name: 'ISC', identifier: 'ISC' },
      description:
        "The rulebooks of bowling associations (USBC, DBU, IBF/World Bowling, EBF/ETBF, BTBA, …): every rule's number, title and page, " +
        'searchable, each with a link to the official document at that page. The rule texts are not served; they stay with the associations, ' +
        'and the link opens them. Rulebooks are re-imported weekly from the official documents.\n\n' +
        'Conventions: `page` is zero-based; list parameters repeat (`association=usbc&association=dbu`). Errors are `{ "error": "..." }`.',
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'Associations', description: 'Associations and federations.' },
      { name: 'Rulebooks', description: 'Rulebooks, their editions and their rules.' },
      { name: 'Search', description: 'Rules across rulebooks.' },
      { name: 'Operations', description: 'Health of the weekly import.' },
    ],
    paths: {
      '/associations': get('listAssociations', 'Associations with their rulebooks', {
        tags: ['Associations'],
        description: 'World and continental federations first, then national associations by short name.',
        parameters: parameters(AssociationQuery),
        responses: { '200': json({ type: 'array', items: ref(Association) }, 'Associations.'), ...errors },
      }),
      '/associations/{id}': get('getAssociation', 'One association', {
        tags: ['Associations'],
        description: 'By id or a former name ("world-bowling" finds the IBF, "etbf" the EBF).',
        parameters: parameters(AssociationPath, 'path'),
        responses: { '200': json(ref(Association), 'The association.'), ...notFound('Unknown association.'), ...errors },
      }),
      '/rulebooks': get('listRulebooks', 'Rulebooks', {
        tags: ['Rulebooks'],
        parameters: parameters(RulebookQuery),
        responses: { '200': json({ type: 'array', items: ref(RulebookSummary) }, 'Rulebooks with their current edition.'), ...errors },
      }),
      '/rulebooks/{id}': get('getRulebook', 'A rulebook with its table of contents', {
        tags: ['Rulebooks'],
        parameters: [...parameters(RulebookPath, 'path'), ...parameters(RulebookDetailQuery)],
        responses: {
          '200': json(ref(Rulebook), 'The rulebook and its rules in document order.'),
          ...notFound('Unknown rulebook or edition, or not imported yet.'),
          ...errors,
        },
      }),
      '/rulebooks/{id}/editions': get('listEditions', 'Editions of a rulebook', {
        tags: ['Rulebooks'],
        description: 'Every version of the document imported so far, newest first.',
        parameters: parameters(RulebookPath, 'path'),
        responses: { '200': json({ type: 'array', items: ref(Edition) }, 'Editions.'), ...notFound('Unknown rulebook.'), ...errors },
      }),
      '/rulebooks/{id}/rules/{key}': get('getRule', 'One rule', {
        tags: ['Rulebooks'],
        description: 'By key or by number as printed ("Rule 4", "§ 12", "3.1.2"). With the sections around it and the link to its page.',
        parameters: [...parameters(RulePath, 'path'), ...parameters(RuleQuery)],
        responses: { '200': json(ref(RuleDetail), 'The rule.'), ...notFound('Unknown rulebook, edition or rule.'), ...errors },
      }),
      '/rules': get('searchRules', 'Search rules', {
        tags: ['Search'],
        description:
          'Finds rules in the current editions by words (in titles, and in the rule texts through a search index; German and English stemming) ' +
          'or by number. Best match first: an exact number, then relevance.',
        parameters: parameters(RuleSearchQuery),
        responses: { '200': json(ref(RuleHitPage), 'One page of matches.'), ...errors },
      }),
      '/health': get('getHealth', 'Import status', {
        tags: ['Operations'],
        description: 'Needs `ADMIN_SECRET`.',
        security: [{ adminSecret: [] }],
        responses: {
          '200': json(ref(Health), 'Status.'),
          ...unauthorized,
          '429': errors['429'],
          '503': json(ref(NotInitialized), 'Database not set up yet.'),
          '500': errors['500'],
        },
      }),
    },
    components: {
      schemas: components,
      securitySchemes: { adminSecret: { type: 'http', scheme: 'bearer', description: '`ADMIN_SECRET`' } },
    },
  };
}
