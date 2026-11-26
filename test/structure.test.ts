import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Line, PdfContent } from '../lib/pdf.js';
import { extractStructure, findEdition, headingTitle, ruleKey } from '../lib/structure.js';

/** A heading-length line, or with `full` a line of running text that fills the column. */
const line = (text: string, { size = 10, full = false } = {}): Line => ({ text, size, left: 50, right: full ? 545 : 50 + text.length * 5 });
const body = (text = 'The quick brown fox jumps over the lazy dog and keeps running along the lane.') => line(text, { full: true });

const content = (pages: Line[][], outline: PdfContent['outline'] = []): PdfContent => ({ pageCount: pages.length, outline, pages, title: null });

const summary = (rules: ReturnType<typeof extractStructure>['rules']) =>
  rules.map((r) => `${'  '.repeat(r.level - 1)}${r.key}|${r.number ?? ''}|${r.title ?? '—'}|p${r.page}`);

test('reads chapters, rules and lettered sub-rules with levels, parents and keys', () => {
  const { source, rules } = extractStructure(
    content([
      [line('Chapter 2 General Playing Rules', { size: 14 }), line('Rule 1 – Certification'), body(), body(), line('Rule 2 The Game'), body()],
      [
        line('2a. Definition'),
        body('A game of tenpins consists of ten frames, delivered by each player in turn.'),
        line('2b How Scored'),
        body(),
        body(),
        body(),
      ],
    ]),
  );
  assert.equal(source, 'headings');
  assert.deepEqual(summary(rules), [
    'chapter-2|Chapter 2|General Playing Rules|p1',
    '  1|Rule 1|Certification|p1',
    '  2|Rule 2|The Game|p1',
    '    2a|2a|Definition|p2',
    '    2b|2b|How Scored|p2',
  ]);
  assert.equal(rules[3]!.parentKey, '2');
  assert.match(rules[3]!.body, /ten frames/);
  assert.doesNotMatch(rules[3]!.body, /How Scored/);
});

test('keeps numbered paragraphs without their text, and labels before a colon', () => {
  const { rules } = extractStructure(
    content([
      [
        line('3.1 Altersklassen'),
        line('3.1.1 Die Altersklassen werden jedes Jahr zum 1. Juli neu festgelegt.'),
        line('3.1.2 A game of tenpins consists of ten frames and a player delivers two balls in', { full: true }),
        line('each of the first nine frames.'),
        line('3.1.3 Breitensportturniere: An einem Breitensportturnier kann jeder teilnehmen.'),
        body(),
      ],
    ]),
  );
  assert.deepEqual(
    rules.map((r) => [r.key, r.title]),
    [
      ['3.1', 'Altersklassen'],
      ['3.1.1', null],
      ['3.1.2', null],
      ['3.1.3', 'Breitensportturniere'],
    ],
  );
});

test('takes the heading printed above a rule number', () => {
  const { rules } = extractStructure(
    content([
      [
        body(),
        body(),
        line('Downward Average Adjustments', { size: 11 }),
        line('Rule 4e. Relief of an average, due to injury, may be granted by the office', { full: true }),
        body(),
        line('Game - Definition', { size: 11 }),
        line('Rule 2a*. A game of tenpins consists of ten frames. A player delivers two balls', { full: true }),
        body(),
      ],
    ]),
  );
  assert.deepEqual(
    rules.map((r) => [r.key, r.number, r.title]),
    [
      ['4e', 'Rule 4e', 'Downward Average Adjustments'],
      ['2a', 'Rule 2a', 'Game - Definition'],
    ],
  );
});

test('skips tables of contents, with and without page numbers', () => {
  const toc = [line('Contents'), line('Rule 1 Certification .......... 3'), line('Rule 2 The Game .......... 4'), line('Rule 3 Fouls .......... 5')];
  const list = [line('1.1 Wettbewerbe'), line('1.2 Meisterschaften'), line('1.3 Spielkleidung'), body()];
  const { rules } = extractStructure(
    content([
      toc,
      list,
      [line('Rule 1 Certification'), body(), line('Rule 2 The Game'), body(), line('Rule 3 Fouls'), body()],
      [line('1.1 Wettbewerbe'), body(), line('1.2 Meisterschaften'), body(), line('1.3 Spielkleidung'), body()],
    ]),
  );
  assert.deepEqual(
    rules.map((r) => `${r.key}@${r.page}`),
    ['1@3', '2@3', '3@3', '1.1@4', '1.2@4', '1.3@4'],
  );
});

test('plain-number chapters count only when printed larger', () => {
  const pages = (size: number) => [[line('1 Allgemeines', { size }), body(), line('1.1 Geltungsbereich'), body(), body(), body()]];
  assert.deepEqual(
    extractStructure(content(pages(14))).rules.map((r) => `${r.level}:${r.key}`),
    ['1:1', '2:1.1'],
  );
  assert.deepEqual(
    extractStructure(content(pages(10))).rules.map((r) => r.key),
    ['1.1'],
  );
});

test('leaves running headers and footers out of the text under a heading', () => {
  const topics = ['pins', 'lanes', 'balls', 'fouls'];
  const page = (n: number) => [
    line('DBU Sportordnung Stand 01.07.2026'),
    line(`${n}.1 Heading ${n}`),
    body(`A paragraph about ${topics[n - 1]}, long enough to fill the line.`),
    line(`Seite ${n}`),
  ];
  const { rules } = extractStructure(content([page(1), page(2), page(3), page(4)]));
  assert.equal(rules.length, 4);
  assert.equal(rules[1]!.body, 'A paragraph about lanes, long enough to fill the line.');
});

test('uses bookmarks, adds the numbered paragraphs they lack, and drops ones that are not sections', () => {
  const pages = [
    [line('Contents')],
    [
      line('CHAPTER 1'),
      line('2. Universal playing rules', { size: 14 }),
      line('2.1 Game definitions'),
      line('2.1.1 A game consists of ten frames for each player.'),
      body(),
    ],
    [line('2.1.2 A strike is made when all ten pins fall with the first ball.'), body(), line('2.2 Style of play'), body(), body()],
  ];
  const { source, rules } = extractStructure(
    content(pages, [
      { title: 'Contents', page: 1, level: 1 },
      { title: 'CHAPTER 1', page: 2, level: 1 },
      { title: 'CHAPTER 1 GENERAL PLAYING RULES', page: 2, level: 2 },
      { title: '2. Universal playing rules', page: 2, level: 1 },
      { title: '2.1 Game definitions', page: 2, level: 2 },
      { title: 'A player may use special equipment to aid in grasping the ball.', page: 2, level: 3 },
      { title: '2.2 Style of play', page: 3, level: 2 },
    ]),
  );
  assert.equal(source, 'outline');
  assert.deepEqual(summary(rules), [
    'chapter-1|CHAPTER 1|GENERAL PLAYING RULES|p2',
    '2|2|Universal playing rules|p2',
    '  2.1|2.1|Game definitions|p2',
    '    2.1.1|2.1.1|—|p2',
    '    2.1.2|2.1.2|—|p3',
    '  2.2|2.2|Style of play|p3',
  ]);
});

test('tells headings from sentences', () => {
  assert.equal(headingTitle('Delivering the Ball'), 'Delivering the Ball');
  assert.equal(headingTitle('Zulässige Bohrungen im Bowlingball'), 'Zulässige Bohrungen im Bowlingball');
  assert.equal(headingTitle('Every delivery counts unless a dead ball is declared.'), null);
  assert.equal(headingTitle('Schiedsrichterentscheidungen sind Tatsachenentscheidungen'), null);
  assert.equal(headingTitle('The ball shall be returned to the player'), null);
  assert.equal(headingTitle('Landesturnier: Startberechtigt sind Mitglieder des Landesverbandes'), 'Landesturnier');
});

test('rule keys: numbers without words, slugs for everything else', () => {
  assert.equal(ruleKey('Rule 4'), '4');
  assert.equal(ruleKey('RULE 101'), '101');
  assert.equal(ruleKey('§ 12a'), '12a');
  assert.equal(ruleKey('§12a'), '12a');
  assert.equal(ruleKey('3.1.2'), '3.1.2');
  assert.equal(ruleKey('2.'), '2');
  assert.equal(ruleKey('Chapter 3'), 'chapter-3');
  assert.equal(ruleKey('Teil II'), 'teil-ii');
  assert.equal(ruleKey('Glossary'), 'glossary');
  assert.equal(ruleKey('Gültige Würfe & Fouls'), 'gultige-wurfe-fouls');
});

test('edition labels from the file name first, then the first pages', () => {
  const pages = [[line('Sportordnung'), line('Stand: 01.07.2026')]];
  assert.equal(findEdition(/Stand:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/, pages, 'https://x/DBU-Sportordnung.pdf'), '01.07.2026');
  assert.equal(findEdition(/(20\d\d-20\d\d)/, [[line('2025-2026 Season')]], 'https://x/2026-2027-Playing-Rules.pdf'), '2026-2027');
  assert.equal(findEdition(undefined, pages, 'https://x/a.pdf'), null);
});
