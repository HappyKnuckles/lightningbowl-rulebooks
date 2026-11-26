// Builds small rulebook PDFs for tests: pages of lines (optionally bigger, for headings) and bookmarks.
import { PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFRef, StandardFonts } from 'pdf-lib';

export type TestLine = string | { text: string; size: number };

export interface TestBookmark {
  title: string;
  /** 1-based page. */
  page: number;
  children?: TestBookmark[];
}

export async function makePdf(
  pages: TestLine[][],
  { bookmarks = [], title }: { bookmarks?: TestBookmark[]; title?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageRefs: PDFRef[] = [];
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    pageRefs.push(page.ref);
    let y = 790;
    for (const line of lines) {
      const { text, size } = typeof line === 'string' ? { text: line, size: 10 } : line;
      page.drawText(text, { x: 50, y, size, font });
      y -= size * 2;
    }
  }
  if (bookmarks.length) addOutline(doc, bookmarks, pageRefs);
  return doc.save();
}

function addOutline(doc: PDFDocument, bookmarks: TestBookmark[], pageRefs: PDFRef[]) {
  const { context } = doc;
  const rootRef = context.nextRef();

  const build = (items: TestBookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => context.nextRef());
    let count = 0;
    items.forEach((item, i) => {
      const dict = context.obj({});
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      dict.set(PDFName.of('Parent'), parent);
      dict.set(PDFName.of('Dest'), context.obj([pageRefs[item.page - 1]!, PDFName.of('XYZ'), null, null, null]));
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!);
      if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]!);
      if (item.children?.length) {
        const children = build(item.children, refs[i]!);
        dict.set(PDFName.of('First'), children.first);
        dict.set(PDFName.of('Last'), children.last);
        dict.set(PDFName.of('Count'), PDFNumber.of(children.count));
        count += children.count;
      }
      context.assign(refs[i]!, dict);
      count++;
    });
    return { first: refs[0]!, last: refs[refs.length - 1]!, count };
  };

  const { first, last, count } = build(bookmarks, rootRef);
  context.assign(rootRef, context.obj({ Type: 'Outlines', First: first, Last: last, Count: count }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}
