// Two small associations with generated rulebook PDFs, served by a fake fetch.
import type { FetchFn } from '../../lib/download.js';
import type { AssociationSource } from '../../lib/sources.js';
import { makePdf } from './pdf.js';

const long = (text: string) => `${text} ${'and more words to fill the line of running text'.slice(0, Math.max(0, 90 - text.length))}`;

export const USBC_PDF = () =>
  makePdf([
    [{ text: 'USBC Playing Rules 2026-2027', size: 16 }],
    [
      { text: 'Chapter 2 General Playing Rules', size: 14 },
      'Rule 4 - Delivering the Ball',
      long('A legal delivery is made when the ball leaves the bowler'),
      '4a. Legal Delivery',
      long('Every delivery counts unless a dead ball is declared'),
      'Rule 5 - Fouls',
      long('A foul occurs when a part of the bowler encroaches beyond the foul line'),
      '5a. Definition',
      long('The foul line is the line between the approach and the lane'),
    ],
    [{ text: 'Chapter 3 League Rules', size: 14 }, 'Rule 100 - Leagues', long('A league is a group of teams bowling a schedule')],
  ]);

export const DBU_PDF = () =>
  makePdf([
    ['Sportordnung', 'Stand: 01.07.2026'],
    [
      { text: '6 Spielbetrieb', size: 14 },
      '6.9 Das Foul',
      long('Ein Foul liegt vor, wenn der Spieler die Foullinie übertritt'),
      '6.9.1 Jeder Wurf mit Übertritt wird als Foul gewertet und nicht gezählt.',
      long('Die Pins zählen nicht'),
      '6.10 Ball reinigen',
      long('Bälle dürfen zwischen den Würfen gereinigt werden'),
    ],
  ]);

export const BASE = 'https://rules.test';

export const ASSOCIATIONS: AssociationSource[] = [
  {
    id: 'usbc',
    name: 'United States Bowling Congress',
    shortName: 'USBC',
    country: 'US',
    scope: 'national',
    website: 'https://bowl.test',
    aliases: [],
    rulebooks: [
      {
        id: 'usbc-playing-rules',
        title: 'USBC Playing Rules',
        language: 'en',
        page: `${BASE}/usbc`,
        url: `${BASE}/usbc-playing-rules.pdf`,
        edition: /(20\d\d-20\d\d)/,
      },
    ],
  },
  {
    id: 'dbu',
    name: 'Deutsche Bowling Union',
    shortName: 'DBU',
    country: 'DE',
    scope: 'national',
    website: 'https://dbu.test',
    aliases: [],
    rulebooks: [
      {
        id: 'dbu-sportordnung',
        title: 'Sportordnung',
        language: 'de',
        page: `${BASE}/dbu`,
        url: `${BASE}/fallback-sportordnung.pdf`,
        discover: { page: `${BASE}/dbu`, link: /Sportordnung[^"']*\.pdf/ },
        edition: /Stand:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/,
      },
    ],
  },
  {
    id: 'ibf',
    name: 'International Bowling Federation',
    shortName: 'IBF',
    country: null,
    scope: 'world',
    website: 'https://ibf.test',
    aliases: ['world-bowling'],
    rulebooks: [],
  },
];

export type Route = Uint8Array | string | Error;

/** Fake fetch over `routes` (by URL); an Error makes that URL fail, a missing one is a 404. */
export function fakeFetch(routes: Record<string, Route>): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response('not found', { status: 404 });
    const headers: Record<string, string> =
      typeof route === 'string'
        ? { 'content-type': 'text/html' }
        : { 'content-type': 'application/pdf', 'last-modified': 'Mon, 02 Nov 2026 10:00:00 GMT' };
    return new Response(typeof route === 'string' ? route : new Blob([route as Uint8Array<ArrayBuffer>]), { status: 200, headers });
  };
  return { fetchFn, calls };
}

export async function defaultRoutes(): Promise<Record<string, Route>> {
  return {
    [`${BASE}/usbc-playing-rules.pdf`]: await USBC_PDF(),
    [`${BASE}/dbu`]: '<a href="/files/DBU-Sportordnung.pdf">Sportordnung</a>',
    [`${BASE}/files/DBU-Sportordnung.pdf`]: await DBU_PDF(),
  };
}
