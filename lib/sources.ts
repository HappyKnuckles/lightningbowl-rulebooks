// The associations and their rulebooks: where the official documents are and how their rules are
// numbered. This is the source of truth; every import writes it to the database.
//
// Only the structure is imported (rule numbers, titles, pages) and linked to the official document;
// the rule text itself stays with the association.

import type { HeadingPattern } from './structure.js';

export type Language = 'en' | 'de';

export interface AssociationSource {
  /** Stable id used in URLs, e.g. "usbc". */
  id: string;
  name: string;
  shortName: string;
  /** ISO 3166-1 alpha-2, or null for international and continental bodies. */
  country: string | null;
  /** A national association, a continental or world federation, or a professional tour. */
  scope: 'national' | 'continental' | 'world' | 'tour';
  website: string;
  /** Other ids and names the association is found by, e.g. former names. */
  aliases: string[];
  rulebooks: RulebookSource[];
}

export interface Discovery {
  /** The official page that links the document. */
  page: string;
  /** Matches the document's link (href) on that page. */
  link: RegExp;
  /** Which matching link to take: the first on the page, or the one with the highest numbers in it (newest season). */
  pick?: 'first' | 'highest';
}

export interface RulebookSource {
  /** Stable id used in URLs, unique across associations, e.g. "usbc-playing-rules". */
  id: string;
  title: string;
  language: Language;
  /** The official page about the rulebook (shown to people). */
  page: string;
  /** The document. Used when there is no `discover`, or the discovery finds nothing. */
  url: string;
  /** Finds the current document on the official page, for documents whose file name changes with each edition. */
  discover?: Discovery;
  /** Finds the edition label (capture group 1) in the first pages or the file name, e.g. a "Stand" date or a season. */
  edition?: RegExp;
  /** Heading patterns for this document, tried before the defaults. */
  headings?: HeadingPattern[];
  /** Ignore the PDF's bookmarks and read the headings from the text. */
  ignoreOutline?: boolean;
}

const DBU_DOWNLOADS = 'https://www.dbu-bowling.de/seite/741737/satzung-ordnungen-und-downloads.html';
const DBU_FILES = 'https://daten2.verwaltungsportal.de/dateien/seitengenerator/0a348d82621e256ff67e285008bc0749238078';
/** "Stand: 01.07.2026" (or "Stand 01.07.2026"), as the DBU documents state their edition. */
const STAND = /Stand:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i;
/** A season like "2026-2027" or "2026/27". */
const SEASON = /\b(20\d\d\s*[-–/]\s*(?:20)?\d\d)\b/;

const dbu = (id: string, title: string, file: string, link: RegExp): RulebookSource => ({
  id: `dbu-${id}`,
  title,
  language: 'de',
  page: DBU_DOWNLOADS,
  url: `${DBU_FILES}/${file}`,
  discover: { page: DBU_DOWNLOADS, link },
  edition: STAND,
});

const BTBA_RESOURCES = 'https://btba.org.uk/resources/';
/** "© BTBA Nov 2026" in the footer. */
const BTBA_EDITION = /©\s*BTBA\s+(\p{L}+\.?\s+20\d\d)/u;

export const ASSOCIATIONS: AssociationSource[] = [
  {
    id: 'usbc',
    name: 'United States Bowling Congress',
    shortName: 'USBC',
    country: 'US',
    scope: 'national',
    website: 'https://bowl.com',
    aliases: [],
    rulebooks: [
      {
        id: 'usbc-playing-rules',
        title: 'USBC Playing Rules',
        language: 'en',
        page: 'https://www.bowl.com/rules',
        url: 'https://images.bowl.com/bowl/media/assets/usbc/rules/general%20pdfs/usbc-playing-rules.pdf',
        edition: SEASON,
      },
    ],
  },
  {
    id: 'dbu',
    name: 'Deutsche Bowling Union',
    shortName: 'DBU',
    country: 'DE',
    scope: 'national',
    website: 'https://www.dbu-bowling.de',
    aliases: [],
    rulebooks: [
      dbu('sportordnung', 'Sportordnung', 'DBU-Sportordnung.pdf', /DBU-Sportordnung\.pdf/),
      dbu('turnierordnung', 'Turnierordnung', 'DBU-Turnierordnung.pdf', /DBU-Turnierordnung\.pdf/),
      dbu(
        'spielrecht-und-ranglistenordnung',
        'Spielrecht- und Ranglistenordnung',
        'DBU-Spielrecht-und-Ranglistenordnung.pdf',
        /DBU-Spielrecht-und-Ranglistenordnung\.pdf/,
      ),
      dbu('schiedsrichterordnung', 'Schiedsrichterordnung', 'DBU-Schiedsrichterordnung.pdf', /DBU-Schiedsrichterordnung\.pdf/),
      dbu('technische-vorschriften', 'Technische Vorschriften', 'DBU-Technische-Vorschriften.pdf', /DBU-Technische-Vorschriften\.pdf/),
      dbu(
        'technische-vorschriften-baelle',
        'Technische Vorschriften – Bälle',
        'DBU-Technische-Vorschriften-Baelle.pdf',
        /DBU-Technische-Vorschriften-Baelle\.pdf/,
      ),
    ],
  },
  {
    id: 'ibf',
    name: 'International Bowling Federation',
    shortName: 'IBF',
    country: null,
    scope: 'world',
    website: 'https://bowling.sport',
    aliases: ['world-bowling', 'world bowling', 'wb', 'wtba'],
    rulebooks: [
      {
        id: 'ibf-statutes-and-playing-rules',
        title: 'Statutes and Playing Rules',
        language: 'en',
        page: 'https://bowling.sport',
        url: 'https://bowling.sport/wp-content/uploads/2026/04/WB-Statutes-as-of-Sept-2019-Modified-2025.pdf',
        edition: /(Sept-2019-Modified-\d{4})/i,
      },
    ],
  },
  {
    id: 'ebf',
    name: 'European Bowling Federation',
    shortName: 'EBF',
    country: null,
    scope: 'continental',
    website: 'https://europeanbowling.sport',
    aliases: ['etbf', 'european tenpin bowling federation'],
    rulebooks: [
      {
        id: 'ebf-championship-rules',
        title: 'Rules for EBF Championships and approved International Tournaments',
        language: 'en',
        page: 'https://europeanbowling.sport',
        url: 'https://europeanbowling.sport/wp-content/uploads/ORG-Rules.pdf',
        edition: /(Release\s+\d+)/i,
      },
    ],
  },
  {
    id: 'btba',
    name: 'British Tenpin Bowling Association',
    shortName: 'BTBA',
    country: 'GB',
    scope: 'national',
    website: 'https://btba.org.uk',
    aliases: [],
    rulebooks: [
      {
        id: 'btba-general-playing-rules',
        title: 'General Playing Rules',
        language: 'en',
        page: BTBA_RESOURCES,
        url: 'https://btba.org.uk/wp-content/uploads/2026/11/General-Playing-Rules-2026-Nov-PLM-1.pdf',
        discover: { page: BTBA_RESOURCES, link: /General-Playing-Rules[^"'<>\s]*\.pdf/ },
        edition: BTBA_EDITION,
      },
      {
        id: 'btba-league-rules',
        title: 'League Playing Rules',
        language: 'en',
        page: BTBA_RESOURCES,
        url: 'https://btba.org.uk/wp-content/uploads/2026/02/League-Rules-2026-1.pdf',
        discover: { page: BTBA_RESOURCES, link: /League-Rules[^"'<>\s]*\.pdf/ },
        edition: BTBA_EDITION,
      },
      {
        id: 'btba-tournament-rules',
        title: 'Tournament Rules',
        language: 'en',
        page: BTBA_RESOURCES,
        url: 'https://btba.org.uk/wp-content/uploads/2026/11/Tournament-Rules-2026-Nov-PLM.pdf',
        discover: { page: BTBA_RESOURCES, link: /Tournament-Rules[^"'<>\s]*\.pdf/ },
        edition: BTBA_EDITION,
      },
    ],
  },
  {
    id: 'tba',
    name: 'Tenpin Bowling Australia',
    shortName: 'TBA',
    country: 'AU',
    scope: 'national',
    website: 'https://tenpin.org.au',
    aliases: [],
    rulebooks: [
      {
        id: 'tba-rule-book',
        title: 'League, Tournament & General Playing Rule Book',
        language: 'en',
        page: 'https://tenpin.org.au/events-listing/rules/',
        url: 'https://tenpin.org.au/wp-content/uploads/2026/10/TBA-Rule-Book-V13.2.pdf',
        discover: { page: 'https://tenpin.org.au/events-listing/rules/', link: /TBA-Rule-Book[^"'<>\s]*\.pdf/, pick: 'highest' },
        edition: /Rule-Book-(V\d+(?:\.\d+)*)/i,
      },
    ],
  },
  {
    id: 'ctf',
    name: 'Canadian Tenpin Federation',
    shortName: 'CTF',
    country: 'CA',
    scope: 'national',
    website: 'https://tenpincanada.com',
    aliases: ['tenpin canada'],
    rulebooks: [
      {
        id: 'ctf-playing-rules',
        title: 'Playing Rules',
        language: 'en',
        page: 'https://tenpincanada.com/home/?p=1986',
        url: 'https://tenpincanada.com/home/wp-content/uploads/2025/02/2026-2027-Playing-Rules.pdf',
        discover: { page: 'https://tenpincanada.com/home/?p=1986', link: /\d{4}-\d{4}-Playing-Rules[^"'<>\s]*\.pdf/, pick: 'highest' },
        edition: SEASON,
      },
    ],
  },
  {
    id: 'oeskb',
    name: 'Österreichischer Sportkegel- und Bowlingverband',
    shortName: 'ÖSKB',
    country: 'AT',
    scope: 'national',
    website: 'https://www.oeskb.at',
    aliases: ['oskb', 'öskb'],
    rulebooks: [
      {
        id: 'oeskb-sportordnung-bowling',
        title: 'Sportordnung Bowling (B3)',
        language: 'de',
        page: 'https://www.oeskb.at',
        url: 'https://www.oeskb.at/wp-content/uploads/2024/12/B3-gesamt-2024-1.pdf',
        edition: STAND,
      },
    ],
  },
];

ASSOCIATIONS.push(
  {
    id: 'pba',
    name: 'Professional Bowlers Association',
    shortName: 'PBA',
    country: 'US',
    scope: 'tour',
    website: 'https://www.pba.com',
    aliases: [],
    rulebooks: [
      {
        id: 'pba-rule-book',
        title: 'PBA Rule Book',
        language: 'en',
        page: 'https://pba.com/player-resources',
        url: 'https://www.pba.com/sites/pba/files/2026-06/PBA%20RULE%20BOOK%202026_Final_6-9-26.pdf',
        discover: { page: 'https://pba.com/player-resources', link: /PBA(?:%20|[\s_-])RULE(?:%20|[\s_-])BOOK[^"'<>]*\.pdf/i },
        edition: /RULE BOOK (20\d\d)/i,
      },
    ],
  },
  {
    id: 'pwba',
    name: "Professional Women's Bowling Association",
    shortName: 'PWBA',
    country: 'US',
    scope: 'tour',
    website: 'https://pwba.com',
    aliases: [],
    rulebooks: [
      {
        id: 'pwba-rulebook',
        title: 'PWBA Rulebook',
        language: 'en',
        page: 'https://pwba.com/player-resources',
        url: 'https://pwba.com/getmedia/ad383869-1039-4491-835e-46a7ef916075/2026-PWBA-Rulebook-Final-v2.pdf',
        discover: { page: 'https://pwba.com/player-resources', link: /PWBA-Rulebook[^"'<>\s]*\.pdf/i, pick: 'highest' },
        edition: /(20\d\d)-PWBA-Rulebook/i,
      },
    ],
  },
);

export const RULEBOOKS: (RulebookSource & { associationId: string })[] = ASSOCIATIONS.flatMap((association) =>
  association.rulebooks.map((rulebook) => ({ ...rulebook, associationId: association.id })),
);
