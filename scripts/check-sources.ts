// Downloads every rulebook (or the ones named) and reports what the import would find, without a
// database: `npm run check-sources [-- <rulebook-id>...] [--verbose] [--annotate]`.
// --verbose lists every rule found; --annotate writes GitHub Actions annotations (one per rulebook).
import { download, resolveUrl } from '../lib/download.js';
import { readPdf } from '../lib/pdf.js';
import { RULEBOOKS } from '../lib/sources.js';
import { DEFAULT_HEADINGS, extractStructure, findEdition, findHeadings } from '../lib/structure.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const annotate = args.includes('--annotate');
const wanted = args.filter((arg) => !arg.startsWith('--'));
const titled = (n: number, total: number) => `${n}/${total}`;
const sources = wanted.length ? RULEBOOKS.filter((r) => wanted.includes(r.id) || wanted.includes(r.associationId)) : RULEBOOKS;

/** Annotation text: GitHub turns %0A into line breaks. */
const escape = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');

let failed = 0;
for (const source of sources) {
  const out: string[] = [];
  let ok = false;
  try {
    const { url, warning } = await resolveUrl(source);
    if (warning) out.push(`discovery: ${warning}`);
    const document = await download(url);
    const content = await readPdf(document.bytes);
    const structure = extractStructure(content, source);
    const fromText = findHeadings(content.pages, [...(source.headings ?? []), ...DEFAULT_HEADINGS]);
    const edition = findEdition(source.edition, content.pages, url) ?? document.lastModified;
    ok = structure.rules.length > 0;
    out.push(
      `url: ${url}`,
      `pages: ${content.pageCount}, bookmarks: ${content.outline.length}, headings in text: ${fromText.length}`,
      `edition: ${edition ?? '-'}, structure from: ${structure.source}, rules: ${structure.rules.length}`,
      `levels: ${[...new Set(structure.rules.map((r) => r.level))].sort().join(',')}, with title: ${titled(structure.rules.filter((r) => r.title).length, structure.rules.length)}, without number: ${structure.rules.filter((r) => !r.number).length}, empty body: ${structure.rules.filter((r) => !r.body).length}`,
    );
    const shown = verbose ? structure.rules : [...structure.rules.slice(0, 40), ...structure.rules.slice(-10)];
    for (const rule of shown) out.push(`${'  '.repeat(rule.level - 1)}${rule.number ?? '·'} ${rule.title ?? '—'} [p${rule.page}, ${rule.key}]`);
    if (!verbose && structure.rules.length > 50) out.splice(out.length - 10, 0, `  … ${structure.rules.length - 50} more`);
    const fewTitles = structure.rules.filter((r) => r.title).length < structure.rules.length * 0.2;
    if (!ok || fewTitles || args.includes('--lines')) {
      // what the text looks like, to write heading patterns for it (short and only the first pages)
      content.pages.slice(0, 4).forEach((lines, i) => out.push(`-- page ${i + 1}`, ...lines.slice(0, 40).map((l) => `${l.size} ${l.text.slice(0, 60)}`)));
    }
    if (verbose && structure.source === 'outline') {
      out.push('bookmarks:', ...content.outline.map((e) => `${'  '.repeat(e.level - 1)}${e.title} [p${e.page}]`));
    }
  } catch (error) {
    out.push(`error: ${(error as Error).message}`);
  }
  if (!ok) failed++;

  const title = `${source.id}${ok ? '' : ' FAILED'}`;
  if (annotate) console.log(`::${ok ? 'notice' : 'error'} title=${title}::${escape(out.join('\n'))}`);
  else console.log(`\n== ${title}\n${out.join('\n')}`);
}

if (failed) {
  console.error(`\n${failed} of ${sources.length} rulebooks failed`);
  process.exitCode = 1;
}
