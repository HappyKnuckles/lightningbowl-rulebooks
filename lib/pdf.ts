// Reads what the structure extraction needs from a PDF: its bookmarks (outline) and its text as lines
// with their font size. Runs pdf.js through unpdf, which works in serverless functions without a worker.
import { getDocumentProxy } from 'unpdf';

export interface OutlineEntry {
  title: string;
  /** 1-based page the bookmark points to, null if it can't be resolved. */
  page: number | null;
  /** 1 for top-level bookmarks. */
  level: number;
}

export interface Line {
  text: string;
  /** Font size of the largest text on the line. */
  size: number;
}

export interface PdfContent {
  pageCount: number;
  outline: OutlineEntry[];
  /** Lines per page, in reading order; index 0 is page 1. */
  pages: Line[][];
  /** Document title from the metadata, if any. */
  title: string | null;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

/** Items on the same baseline (within this many units) form one line. */
const SAME_LINE = 2;

export async function readPdf(data: Uint8Array): Promise<PdfContent> {
  // pdf.js takes ownership of the buffer; keep the caller's bytes intact (they are hashed and may be reused)
  const pdf = await getDocumentProxy(data.slice());
  try {
    const pages: Line[][] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(toLines(content.items.filter((item) => 'str' in item) as TextItem[]));
      page.cleanup();
    }

    const outline: OutlineEntry[] = [];
    const walk = async (nodes: OutlineNode[] | null, level: number) => {
      for (const node of nodes ?? []) {
        outline.push({ title: cleanText(node.title), page: await resolvePage(pdf, node.dest), level });
        await walk(node.items, level + 1);
      }
    };
    await walk((await pdf.getOutline()) as OutlineNode[] | null, 1);

    const { info } = (await pdf.getMetadata().catch(() => ({ info: {} }))) as { info: { Title?: unknown } };
    const title = typeof info?.Title === 'string' && info.Title.trim() ? cleanText(info.Title) : null;

    return { pageCount: pdf.numPages, outline, pages, title };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function resolvePage(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, dest: OutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (typeof target === 'number') return target + 1;
    if (target && typeof target === 'object') return (await pdf.getPageIndex(target as Parameters<typeof pdf.getPageIndex>[0])) + 1;
  } catch {
    // a broken bookmark keeps its title, without a page
  }
  return null;
}

/** Groups text items into lines (top to bottom, left to right). */
export function toLines(items: TextItem[]): Line[] {
  const placed = items
    .filter((item) => item.str.length > 0)
    .map((item) => ({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width, size: Math.abs(item.height) }));
  placed.sort((a, b) => (Math.abs(a.y - b.y) <= SAME_LINE ? a.x - b.x : b.y - a.y));

  const lines: { parts: typeof placed }[] = [];
  for (const item of placed) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.parts[0]!.y - item.y) <= SAME_LINE) current.parts.push(item);
    else lines.push({ parts: [item] });
  }

  return lines
    .map(({ parts }) => {
      let text = '';
      let end = -Infinity;
      for (const part of parts) {
        // a visible gap between two items is a space the PDF didn't spell out
        if (text && !/\s$/.test(text) && !/^\s/.test(part.str) && part.x - end > part.size * 0.15) text += ' ';
        text += part.str;
        end = part.x + part.width;
      }
      return { text: cleanText(text), size: Math.round(Math.max(...parts.map((p) => p.size)) * 10) / 10 };
    })
    .filter((line) => line.text.length > 0);
}

/** Collapses whitespace and drops control characters. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u001f­]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
