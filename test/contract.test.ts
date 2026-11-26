// Every endpoint's real response must match the schema the docs publish, and the committed openapi.json
// must match what the schemas generate.
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import association from '../api/associations/[id].js';
import associations from '../api/associations/index.js';
import docs from '../api/docs.js';
import health from '../api/health.js';
import openapi from '../api/openapi.js';
import editions from '../api/rulebooks/[id]/editions.js';
import rulebook from '../api/rulebooks/[id]/index.js';
import rule from '../api/rulebooks/[id]/rules/[key].js';
import rulebooks from '../api/rulebooks/index.js';
import rules from '../api/rules.js';
import type { Handler } from '../lib/http.js';
import { runImport } from '../lib/importer.js';
import { ApiError, Association, Edition, Health, type RawQuery, RuleDetail, RuleHitPage, Rulebook, RulebookSummary } from '../lib/schemas.js';
import { serializeOpenApi } from '../scripts/openapi.js';
import { startDatabase } from './helpers/db.js';
import { ASSOCIATIONS, defaultRoutes, fakeFetch } from './helpers/fixtures.js';
import { call } from './helpers/http.js';

let stop: () => Promise<void>;
before(async () => {
  stop = await startDatabase();
  await runImport({ associations: ASSOCIATIONS, fetchFn: fakeFetch(await defaultRoutes()).fetchFn, log: () => {} });
});
after(() => stop());

const cases: [string, Handler, RawQuery, z.ZodType, Record<string, string>?][] = [
  ['associations', associations, {}, z.array(Association)],
  ['association', association, { id: 'usbc' }, Association],
  ['rulebooks', rulebooks, {}, z.array(RulebookSummary)],
  ['rulebook', rulebook, { id: 'usbc-playing-rules' }, Rulebook],
  ['editions', editions, { id: 'dbu-sportordnung' }, z.array(Edition)],
  ['rule', rule, { id: 'usbc-playing-rules', key: '5a' }, RuleDetail],
  ['untitled rule', rule, { id: 'dbu-sportordnung', key: '6.9.1' }, RuleDetail],
  ['search', rules, { search: 'foul' }, RuleHitPage],
  ['not found', rule, { id: 'usbc-playing-rules', key: 'x' }, ApiError],
  ['bad request', rules, {}, ApiError],
  ['health', health, {}, Health, { authorization: `Bearer test-admin-secret` }],
];

for (const [name, handler, query, schema, headers] of cases) {
  test(`${name} matches its schema`, async () => {
    const res = await call(handler, query, { headers });
    const result = schema.safeParse(res.body);
    assert.ok(result.success, `${name}: ${result.success ? '' : JSON.stringify(result.error.issues.slice(0, 3))}`);
  });
}

test('openapi.json is up to date (run `npm run openapi`)', async () => {
  assert.equal(readFileSync('openapi.json', 'utf8'), serializeOpenApi());
  const res = await call(openapi);
  assert.equal(res.body.openapi, '3.1.0');
  assert.ok((await call(docs)).text?.includes('swagger-ui'));
});
