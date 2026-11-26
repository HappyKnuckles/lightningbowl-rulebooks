# Lightning Bowl Rulebooks API

Look up the rules of bowling associations. For every rulebook the API knows each rule's number, title, level and page, and links to the official document opened at that page. Rules can be listed as a table of contents, fetched by number ("Rule 4", "§ 12", "3.1.2") or searched across all rulebooks.

The rule texts are not stored or served. They stay with the associations, and every rule links to them. The search runs on a Postgres full-text index (lexemes) built from the text at import time. The text itself is thrown away.

- **Runtime:** TypeScript (strict) on Node 20+ serverless functions on Vercel, the same setup as [lightningbowl-ball-api](https://github.com/HappyKnuckles/lightningbowl-ball-api)
- **Contract:** Zod schemas in `lib/schemas.ts` validate every request, give the TypeScript types and generate the OpenAPI document (`openapi.json`, `/api/docs`)
- **Database:** Postgres 16+ with `pg_trgm` (Neon)
- **Import:** Vercel Cron, weekly on Mondays at 02:41 UTC, from the official PDFs

## Rulebooks

| Association                                                           | Rulebooks                                                                                                                                        | Language |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| IBF – International Bowling Federation (formerly World Bowling, WTBA) | Statutes and Playing Rules                                                                                                                       | en       |
| EBF – European Bowling Federation (formerly ETBF)                     | Rules for EBF Championships and approved International Tournaments                                                                               | en       |
| USBC – United States Bowling Congress                                 | Playing Rules                                                                                                                                    | en       |
| DBU – Deutsche Bowling Union                                          | Sportordnung, Turnierordnung, Spielrecht- und Ranglistenordnung, Schiedsrichterordnung, Technische Vorschriften, Technische Vorschriften – Bälle | de       |
| BTBA – British Tenpin Bowling Association                             | General Playing Rules, League Playing Rules, Tournament Rules                                                                                    | en       |
| TBA – Tenpin Bowling Australia                                        | League, Tournament & General Playing Rule Book                                                                                                   | en       |
| CTF – Canadian Tenpin Federation                                      | Playing Rules                                                                                                                                    | en       |
| ÖSKB – Österreichischer Sportkegel- und Bowlingverband                | Sportordnung Bowling (B3)                                                                                                                        | de       |

They are configured in `lib/sources.ts`, together with where each document lives and how its edition is labelled.

## Endpoints

All `GET`, public, readable from any origin, 100 requests per minute per IP. Full reference in `/api/docs`.

| Endpoint                          | What it returns                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/api/associations`               | Associations with their rulebooks. Filters: `search`, `country`, `scope`, `language`                             |
| `/api/associations/{id}`          | One association, also by former name (`world-bowling` → IBF, `etbf` → EBF)                                       |
| `/api/rulebooks`                  | Rulebooks with their current edition. Filters: `association`, `language`, `search`                               |
| `/api/rulebooks/{id}`             | A rulebook with its table of contents. `maxLevel=1` for chapters only, `edition` for an older one                |
| `/api/rulebooks/{id}/editions`    | Every edition imported so far, newest first                                                                      |
| `/api/rulebooks/{id}/rules/{key}` | One rule by key or printed number, with breadcrumbs, children, previous and next                                 |
| `/api/rules?search=`              | Search across rulebooks (titles, texts, numbers). Filters: `association`, `rulebook`, `language`, `page`, `size` |
| `/api/health`                     | Import status and failing rulebooks (needs `ADMIN_SECRET`)                                                       |

```bash
curl 'https://<host>/api/rules?search=foul%20line&association=usbc'
curl 'https://<host>/api/rulebooks/usbc-playing-rules/rules/Rule%205'
curl 'https://<host>/api/rulebooks/dbu-sportordnung?maxLevel=2'
```

A rule looks like this:

```json
{
  "key": "5a",
  "number": "5a",
  "title": "Definition",
  "level": 3,
  "parent_key": "5",
  "page": 13,
  "link": "https://images.bowl.com/…/usbc-playing-rules.pdf#page=13"
}
```

- **`title` is null** for numbered paragraphs that have no heading of their own (IBF 2.1.1, DBU 1.1, …). Their first words are rule text, so they aren't kept.
- **`link`** uses the PDF `#page=` open parameter, which the browsers' PDF viewers understand.

## How the import reads a rulebook

`lib/importer.ts` writes the configured associations and rulebooks, then handles each rulebook in turn.

1. **Find the document.** Rulebooks whose file name changes with each edition (BTBA, TBA, CTF, DBU) are looked up on the association's page (`discover`). If that fails, the configured URL is used and the run notes a warning.
2. **Download it** and hash it (SHA-256). A document seen before only marks the rulebook as checked.
3. **Read its structure** (`lib/structure.ts`).
   - **From the bookmarks**, when the PDF has at least three. Numbered paragraphs that have no bookmark are added from the text.
   - **From the text** otherwise: lines numbered like "Chapter 3", "Rule 4", "§ 12", "3.1.2", "4a." or a plain larger "3".
   - **Tables of contents are skipped.** They are recognised by page numbers after leader dots, or by headings that come again later.
   - **A title that is really a sentence is dropped**, leaving just the number. That is the case when it runs on into the next line, fills the text column, or reads like a sentence ("shall", "ist", …).
   - **A heading printed above the rule number** is used as its title.
4. **Store a new edition** with its rules and make it current.

**Edition labels** come from the file name or the first pages ("Stand 01.07.2026", "2026-2027", "Release 36", "V13.2"). Otherwise the file's Last-Modified date is used.

**Failures are isolated.** A rulebook that fails (download, unreadable PDF, no rules found) keeps its current edition. The error shows in `/api/health` and in the run (`import_runs`). Overlapping runs are skipped.

**Checking the sources.** The **Sources** workflow (on pull requests, weekly, and by hand) downloads every rulebook and reports what the import would find, one annotation per rulebook. Locally: `npm run check-sources [-- <rulebook-or-association-id>] [--verbose] [--lines]`.

## Setup

1. **Deploy to Vercel** and connect a Neon database (Storage → Neon). The integration sets `DATABASE_URL` / `POSTGRES_URL`.
2. **Add the secrets.** Set `CRON_SECRET` and `ADMIN_SECRET` (two different long random strings, e.g. `openssl rand -hex 32`), then redeploy.
3. **Run the first import.** Go to Vercel → project → **Settings → Cron Jobs** → **Run** next to `/api/cron/import`. It creates the tables and imports every rulebook, which takes about a minute. After that it runs weekly on its own.
4. **Check it** with `curl -H "Authorization: Bearer $ADMIN_SECRET" https://<host>/api/health`. `counts.rulebooks_without_edition` should be 0 and `failing` empty.

**Local development:** copy `.env.example` to `.env.local`, then:

- `npm install`
- `npm run import` (also migrates). Takes rulebook or association ids to import only those, and `--force` to re-read unchanged documents after improving the extraction.
- `npm run dev` (http://localhost:3004, docs at `/api/docs`)

`npm test` runs against a throwaway embedded Postgres with generated PDFs and needs neither a database nor the network. `npm run typecheck` runs `tsc`. After changing `lib/schemas.ts`, run `npm run openapi`; a test fails if `openapi.json` is stale.

## Adding an association or rulebook

1. **Configure it.** Add it to `ASSOCIATIONS` in `lib/sources.ts`: the document URL, the official page, and `discover` if the file name changes per edition.
2. **Check what is found** with `npm run check-sources -- <id> --verbose`. If the numbering isn't recognised, add `headings` patterns for that rulebook, and `--lines` shows how the text reads.
3. **Add its id to the matrix** in `.github/workflows/sources.yml`.
