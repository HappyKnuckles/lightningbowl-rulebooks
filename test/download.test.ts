import { test } from 'node:test';
import assert from 'node:assert/strict';
import { download, pickLink, resolveUrl } from '../lib/download.js';
import { readPdf } from '../lib/pdf.js';
import type { RulebookSource } from '../lib/sources.js';
import { fakeFetch } from './helpers/fixtures.js';
import { makePdf } from './helpers/pdf.js';

const page = 'https://assoc.test/rules/';

test('picks the matching link on the official page, as an absolute URL', () => {
  const html = `
    <a href="/files/League-Rules-2025.pdf">old</a>
    <a href='https://cdn.test/League-Rules-2026-1.pdf?x=1&amp;y=2'>new</a>
    <a href="Tournament-Rules.pdf">other</a>`;
  assert.equal(pickLink(html, { page, link: /League-Rules[^"']*\.pdf/ }), 'https://assoc.test/files/League-Rules-2025.pdf');
  assert.equal(pickLink(html, { page, link: /League-Rules[^"']*\.pdf/, pick: 'highest' }), 'https://cdn.test/League-Rules-2026-1.pdf?x=1&y=2');
  assert.equal(pickLink(html, { page, link: /Tournament-Rules\.pdf/ }), 'https://assoc.test/rules/Tournament-Rules.pdf');
  assert.equal(pickLink(html, { page, link: /Bylaws\.pdf/ }), null);
});

test('the newest season wins with pick "highest"', () => {
  const html = ['2025-2026-Playing-Rules.pdf', '2026-2027-Playing-Rules.pdf', '2024-2025-Playing-Rules.pdf']
    .map((f) => `<a href="/${f}">x</a>`)
    .join('');
  assert.equal(pickLink(html, { page, link: /\d{4}-\d{4}-Playing-Rules\.pdf/, pick: 'highest' }), 'https://assoc.test/2026-2027-Playing-Rules.pdf');
});

test('uses the configured URL when discovery finds nothing or the page fails', async () => {
  const source = { url: 'https://assoc.test/fallback.pdf', discover: { page, link: /Rules\.pdf/ } } as RulebookSource;
  const empty = await resolveUrl(source, fakeFetch({ [page]: '<p>moved</p>' }).fetchFn);
  assert.equal(empty.url, source.url);
  assert.match(empty.warning!, /no link matching/);
  const down = await resolveUrl(source, fakeFetch({ [page]: new Error('timeout') }).fetchFn);
  assert.match(down.warning!, /could not read .*timeout/);
  assert.deepEqual(await resolveUrl({ url: source.url } as RulebookSource), { url: source.url, warning: null });
});

test('downloads a PDF with its hash and date, and refuses anything else', async () => {
  const pdf = await makePdf([['Rule 1 The Game']]);
  const { fetchFn } = fakeFetch({ 'https://a.test/r.pdf': pdf, 'https://a.test/page': '<html></html>' });
  const document = await download('https://a.test/r.pdf', fetchFn);
  assert.match(document.sha256, /^[0-9a-f]{64}$/);
  assert.equal(document.lastModified, '2026-11-02');
  await assert.rejects(download('https://a.test/page', fetchFn), /not a PDF/);
  await assert.rejects(download('https://a.test/missing.pdf', fetchFn), /HTTP 404/);
});

test('reads lines, sizes and bookmarks from a PDF', async () => {
  const pdf = await makePdf([[{ text: 'Chapter 1 General', size: 14 }, 'Rule 1 - The Game'], ['Rule 2 - Fouls']], {
    title: 'Playing Rules',
    bookmarks: [{ title: 'Chapter 1 General', page: 1, children: [{ title: 'Rule 2 - Fouls', page: 2 }] }],
  });
  const content = await readPdf(pdf);
  assert.equal(content.pageCount, 2);
  assert.equal(content.title, 'Playing Rules');
  assert.deepEqual(
    content.pages[0]!.map((l) => [l.text, l.size]),
    [
      ['Chapter 1 General', 14],
      ['Rule 1 - The Game', 10],
    ],
  );
  assert.deepEqual(content.outline, [
    { title: 'Chapter 1 General', page: 1, level: 1 },
    { title: 'Rule 2 - Fouls', page: 2, level: 2 },
  ]);
});
