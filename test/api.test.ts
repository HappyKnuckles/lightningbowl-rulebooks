import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import association from '../api/associations/[id].js';
import associations from '../api/associations/index.js';
import cron from '../api/cron/import.js';
import health from '../api/health.js';
import editions from '../api/rulebooks/[id]/editions.js';
import rulebook from '../api/rulebooks/[id]/index.js';
import rule from '../api/rulebooks/[id]/rules/[key].js';
import rulebooks from '../api/rulebooks/index.js';
import rules from '../api/rules.js';
import { query } from '../lib/db.js';
import { runImport } from '../lib/importer.js';
import type { ImportRun } from '../lib/schemas.js';
import { resetDatabase, startDatabase } from './helpers/db.js';
import { ASSOCIATIONS, BASE, DBU_PDF, defaultRoutes, fakeFetch, type Route } from './helpers/fixtures.js';
import { call } from './helpers/http.js';
import { makePdf } from './helpers/pdf.js';

let stop: () => Promise<void>;
before(async () => {
  stop = await startDatabase();
});
after(() => stop());

let routes: Record<string, Route>;
beforeEach(async () => {
  await resetDatabase();
  routes = await defaultRoutes();
});

const importNow = async (options: Parameters<typeof runImport>[0] = {}) =>
  (await runImport({ associations: ASSOCIATIONS, fetchFn: fakeFetch(routes).fetchFn, log: () => {}, ...options })) as ImportRun;

test('imports each rulebook as an edition with its rules, and skips unchanged documents', async () => {
  const first = await importNow();
  assert.equal(first.status, 'success');
  assert.deepEqual(first.stats['usbc-playing-rules'], {
    status: 'imported',
    url: `${BASE}/usbc-playing-rules.pdf`,
    edition: '2026-2027',
    rules: 7,
    structure: 'headings',
  });
  // found on the official page, not the fallback URL
  assert.equal((first.stats['dbu-sportordnung'] as { url: string }).url, `${BASE}/files/DBU-Sportordnung.pdf`);
  assert.equal((first.stats['dbu-sportordnung'] as { edition: string }).edition, '01.07.2026');

  const second = await importNow();
  assert.equal((second.stats['usbc-playing-rules'] as { status: string }).status, 'unchanged');
  assert.equal((await query('SELECT count(*)::int AS n FROM editions')).rows[0]!.n, 2);
});

test('a changed document becomes the current edition; a failing one keeps it', async () => {
  await importNow();
  routes[`${BASE}/files/DBU-Sportordnung.pdf`] = await makePdf([
    ['Sportordnung', 'Stand: 01.01.2027'],
    ['7.1 Spielweisen', 'Einzel, Doppel und Mannschaft werden in Serien gespielt und gewertet.'],
  ]);
  const run = await importNow();
  assert.equal((run.stats['dbu-sportordnung'] as { edition: string }).edition, '01.01.2027');
  const history = await call(editions, { id: 'dbu-sportordnung' });
  assert.deepEqual(
    history.body.map((e: { label: string }) => e.label),
    ['01.01.2027', '01.07.2026'],
  );

  routes[`${BASE}/usbc-playing-rules.pdf`] = new Error('connection reset');
  const failed = await importNow();
  assert.equal(failed.status, 'partial');
  assert.match(failed.errors[0]!, /usbc-playing-rules: connection reset/);
  const usbc = await call(rulebook, { id: 'usbc-playing-rules' });
  assert.equal(usbc.statusCode, 200);
  assert.equal(usbc.body.edition.label, '2026-2027');

  const status = await call(health, {}, { headers: { authorization: `Bearer ${process.env.ADMIN_SECRET}` } });
  assert.deepEqual(
    status.body.failing.map((f: { id: string }) => f.id),
    ['usbc-playing-rules'],
  );
});

test('a document without recognisable rules fails instead of emptying the rulebook', async () => {
  await importNow();
  routes[`${BASE}/files/DBU-Sportordnung.pdf`] = await makePdf([['Just a cover page'], ['and some prose without numbers']]);
  const run = await importNow();
  assert.match(run.errors.join(), /dbu-sportordnung: no rules found/);
  assert.equal((await call(rulebook, { id: 'dbu-sportordnung' })).body.rules.length, 4);
});

test('lists associations (world federations first) and finds them by former names', async () => {
  await importNow();
  const list = await call(associations);
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['access-control-allow-origin'], '*');
  assert.deepEqual(
    list.body.map((a: { id: string }) => a.id),
    ['ibf', 'dbu', 'usbc'],
  );
  assert.equal(list.body[2].rulebooks[0].edition.rule_count, 7);
  assert.deepEqual(
    (await call(associations, { country: 'de' })).body.map((a: { id: string }) => a.id),
    ['dbu'],
  );
  assert.deepEqual(
    (await call(associations, { language: 'en' })).body.map((a: { id: string }) => a.id),
    ['usbc'],
  );
  assert.equal((await call(association, { id: 'World-Bowling' })).body.id, 'ibf');
  assert.equal((await call(association, { id: 'nope' })).statusCode, 404);
});

test('lists rulebooks and returns one with its table of contents', async () => {
  await importNow();
  assert.deepEqual(
    (await call(rulebooks, { association: 'dbu' })).body.map((r: { id: string }) => r.id),
    ['dbu-sportordnung'],
  );
  const book = await call(rulebook, { id: 'usbc-playing-rules' });
  assert.equal(book.body.association.short_name, 'USBC');
  assert.deepEqual(book.body.rules[1], {
    key: '4',
    number: 'Rule 4',
    title: 'Delivering the Ball',
    level: 2,
    parent_key: 'chapter-2',
    page: 2,
    link: `${BASE}/usbc-playing-rules.pdf#page=2`,
  });
  assert.deepEqual(
    (await call(rulebook, { id: 'usbc-playing-rules', maxLevel: '1' })).body.rules.map((r: { key: string }) => r.key),
    ['chapter-2', 'chapter-3'],
  );
  assert.equal((await call(rulebook, { id: 'nope' })).statusCode, 404);
  assert.equal((await call(rulebook, { id: 'usbc-playing-rules', edition: '999' })).statusCode, 404);
});

test('returns one rule by key or printed number, with where it sits', async () => {
  await importNow();
  for (const key of ['5', 'Rule 5', 'rule5']) {
    const res = await call(rule, { id: 'usbc-playing-rules', key });
    assert.equal(res.statusCode, 200, key);
    assert.equal(res.body.title, 'Fouls');
  }
  const res = await call(rule, { id: 'usbc-playing-rules', key: '5a' });
  assert.deepEqual(
    res.body.breadcrumbs.map((r: { key: string }) => r.key),
    ['chapter-2', '5'],
  );
  assert.equal(res.body.previous.key, '5');
  assert.equal(res.body.next.key, 'chapter-3');
  assert.equal(res.body.edition.label, '2026-2027');
  assert.deepEqual(
    (await call(rule, { id: 'usbc-playing-rules', key: 'chapter-2' })).body.children.map((r: { key: string }) => r.key),
    ['4', '5'],
  );
  // a numbered paragraph has no title of its own
  assert.equal((await call(rule, { id: 'dbu-sportordnung', key: '6.9.1' })).body.title, null);
  assert.equal((await call(rule, { id: 'usbc-playing-rules', key: '99' })).statusCode, 404);
});

test('searches rule titles, the rule texts and numbers, with stemming per language', async () => {
  await importNow();
  const fouls = await call(rules, { q: 'fouls' });
  assert.equal(fouls.statusCode, 200);
  // "Fouls" (title), "5a" (text: "foul line") and the German "Das Foul"
  const keys = fouls.body.content.map((r: { rulebook: { id: string }; key: string }) => `${r.rulebook.id}:${r.key}`);
  assert.equal(keys[0], 'usbc-playing-rules:5');
  assert.ok(keys.includes('usbc-playing-rules:5a'));

  // only in a rule's text, never in a title: found through the index, and the text isn't returned
  const delivery = await call(rules, { search: 'dead ball', rulebook: 'usbc-playing-rules' });
  assert.equal(delivery.body.content[0].key, '4a');
  assert.equal('body' in delivery.body.content[0], false);

  // German stemming: "Würfen" finds "Wurf"
  const wurf = await call(rules, { search: 'Wurf', language: 'de' });
  assert.ok(wurf.body.content.some((r: { key: string }) => r.key === '6.9.1'));

  const byNumber = await call(rules, { search: 'Rule 100' });
  assert.equal(byNumber.body.content[0].key, '100');
  assert.equal(byNumber.body.content[0].association.id, 'usbc');

  const dbu = await call(rules, { search: 'fouls', association: 'dbu' });
  assert.deepEqual(
    dbu.body.content.map((r: { key: string }) => r.key),
    ['6.9', '6.9.1'],
  );
  const paged = await call(rules, { search: 'fouls', size: '1', page: '5' });
  assert.deepEqual(paged.body.content, []);
  assert.ok(paged.body.page.totalElements >= 2);
  assert.equal((await call(rules)).statusCode, 400);
});

test('answers 503 instead of failing before the first import created the tables', async () => {
  await query('ALTER TABLE associations RENAME TO associations_hidden');
  try {
    const res = await call(associations);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /No rulebooks imported yet/);
  } finally {
    await query('ALTER TABLE associations_hidden RENAME TO associations');
  }
});

test('health and the cron endpoint need their secrets', async () => {
  assert.equal((await call(health)).statusCode, 401);
  assert.equal((await call(cron)).statusCode, 401);
  const status = await call(health, {}, { headers: { authorization: `Bearer ${process.env.ADMIN_SECRET}` } });
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.status, 'empty');
});

test('a second import while one runs is skipped', async () => {
  await query(`INSERT INTO import_runs (trigger) VALUES ('test')`);
  assert.deepEqual(await runImport({ associations: ASSOCIATIONS, fetchFn: fakeFetch(routes).fetchFn, log: () => {} }), { skipped: true });
});

test('falls back to the configured URL when the official page has no link', async () => {
  routes[`${BASE}/dbu`] = '<p>nothing here</p>';
  routes[`${BASE}/fallback-sportordnung.pdf`] = await DBU_PDF();
  const run = await importNow({ only: ['dbu'] });
  assert.equal((run.stats['dbu-sportordnung'] as { url: string }).url, `${BASE}/fallback-sportordnung.pdf`);
  assert.match((run.stats['dbu-sportordnung'] as { warning: string }).warning, /no link matching/);
  assert.deepEqual(Object.keys(run.stats), ['dbu-sportordnung']);
});
