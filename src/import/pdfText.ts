/** Minimal subset of the pdfjs-dist API used here (injectable, so tests can use the Node build). */
export interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  /** rendering, used only by the OCR fallback in the browser */
  getViewport?(o: { scale: number }): { width: number; height: number };
  render?(o: { canvasContext: unknown; viewport: unknown; canvas?: unknown }): { promise: Promise<void> };
}
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
  getMetadata?(): Promise<{ info?: unknown }>;
}
export interface PdfJsLib {
  getDocument(src: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    stopAtErrors?: boolean;
    useWorkerFetch?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfDocument> };
}

export type PdfImportErrorKind = "not-pdf" | "too-big" | "unreadable" | "no-text" | "no-payslip";

export class PdfImportError extends Error {
  constructor(
    readonly kind: PdfImportErrorKind,
    message: string
  ) {
    super(message);
    this.name = "PdfImportError";
  }
}

interface Item {
  conf?: number;
  str: string;
  dir: number;
  along: number;
  across: number;
  width: number;
}

/** One word on a text line with its horizontal position (PDF units, or 5 per character for plain text). */
export interface Token {
  s: string;
  x: number;
  w: number;
  /** OCR word confidence 0-100 (only for text read by OCR) */
  c?: number;
}

/** A text line: the plain text plus its words with positions, so table columns can be mapped. */
export interface TextLine {
  text: string;
  tokens: Token[];
  /** read by text recognition (OCR) instead of the PDF text layer */
  ocr?: boolean;
}

/** Plain-text line (tests, pasted text): one character counts as 5 units, so runs of 2+ spaces separate groups. */
export function textLine(s: string): TextLine {
  const tokens: Token[] = [];
  for (const m of s.matchAll(/\S+/g)) tokens.push({ s: m[0], x: (m.index ?? 0) * 5, w: m[0].length * 5 });
  return { text: tokens.map((t) => t.s).join(" "), tokens };
}

export function toTextLines(lines: (string | TextLine)[]): TextLine[] {
  return lines.map((l) => (typeof l === "string" ? textLine(l) : l)).filter((l) => l.tokens.length > 0);
}

/**
 * Rebuild text lines from pdf.js text items (also for rotated pages): items are grouped by
 * text direction and by their position perpendicular to it, then sorted left to right.
 * Each item is split into words; a word's position is estimated from its share of the item width.
 */
export function textLinesFromItems(items: unknown[]): TextLine[] {
  const el: Item[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object" || !("str" in it) || !("transform" in it)) continue;
    const { str, transform, width, conf } = it as { str: string; transform: number[]; width?: number; conf?: number };
    if (typeof str !== "string" || !str.trim()) continue;
    const [a = 1, b = 0, , , e = 0, f = 0] = transform;
    const dir = Math.round(Math.atan2(b, a) / (Math.PI / 2)) & 3;
    const cos = [1, 0, -1, 0][dir] ?? 1;
    const sin = [0, 1, 0, -1][dir] ?? 0;
    const size = Math.hypot(a, b) || 10;
    const w = typeof width === "number" && width > 0 ? width : size * 0.5 * str.length;
    el.push({ str, dir, along: e * cos + f * sin, across: -e * sin + f * cos, width: w, ...(typeof conf === "number" ? { conf } : {}) });
  }
  el.sort((x, y) => x.dir - y.dir || y.across - x.across || x.along - y.along);
  const groups: Item[][] = [];
  for (const e of el) {
    const last = groups[groups.length - 1];
    const ref = last?.[0];
    if (last && ref && ref.dir === e.dir && Math.abs(ref.across - e.across) < 3) last.push(e);
    else groups.push([e]);
  }
  return groups.map((z) => {
    const tokens: Token[] = [];
    for (const e of z.sort((x, y) => x.along - y.along)) {
      const len = e.str.length || 1;
      for (const m of e.str.matchAll(/\S+/g)) {
        tokens.push({ s: m[0], x: e.along + (e.width * (m.index ?? 0)) / len, w: (e.width * m[0].length) / len, ...(e.conf !== undefined ? { c: e.conf } : {}) });
      }
    }
    const ocr = z.some((e) => e.conf !== undefined);
    return { text: tokens.map((t) => t.s).join(" "), tokens, ...(ocr ? { ocr: true } : {}) };
  });
}

/** Text only (kept for callers that just need strings). */
export function linesFromItems(items: unknown[]): string[] {
  return textLinesFromItems(items).map((l) => l.text);
}

export async function openPdf(data: ArrayBuffer | Uint8Array, pdfjs: PdfJsLib): Promise<PdfDocument> {
  try {
    // copy: pdf.js may transfer (detach) the buffer it gets
    const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
    return await pdfjs.getDocument({
      data: bytes,
      // no eval, no font loading, no worker-side fetching of font/cmap data: text only
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    throw new PdfImportError("unreadable", `The PDF could not be read (${e instanceof Error ? e.message : String(e)}).`);
  }
}

export async function textFromDocument(doc: PdfDocument, maxPages = 5): Promise<TextLine[]> {
  return (await textPagesFromDocument(doc, maxPages)).flat();
}

/** Text lines per page (the OCR fallback decides page by page). */
export async function textPagesFromDocument(doc: PdfDocument, maxPages = 5): Promise<TextLine[][]> {
  const out: TextLine[][] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(textLinesFromItems(tc.items));
  }
  return out;
}

/** Producer / creator of the PDF (helps to recognise the payroll program); never required. */
export async function pdfProducer(doc: PdfDocument): Promise<string> {
  try {
    const m = await doc.getMetadata?.();
    const info = (m?.info ?? {}) as Record<string, unknown>;
    return [info.Producer, info.Creator].filter((v): v is string => typeof v === "string").join(" ");
  } catch {
    return "";
  }
}
