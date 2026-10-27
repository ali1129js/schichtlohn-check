/** Minimal subset of the pdfjs-dist API used here (injectable, so tests can use the Node build). */
export interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
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
  str: string;
  dir: number;
  along: number;
  across: number;
}

/**
 * Rebuild text lines from pdf.js text items (also for rotated pages): items are grouped by
 * text direction and by their position perpendicular to it, then sorted left to right.
 */
export function linesFromItems(items: unknown[]): string[] {
  const el: Item[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object" || !("str" in it) || !("transform" in it)) continue;
    const { str, transform } = it as { str: string; transform: number[] };
    if (!str.trim()) continue;
    const [a = 1, b = 0, , , e = 0, f = 0] = transform;
    const dir = Math.round(Math.atan2(b, a) / (Math.PI / 2)) & 3;
    const cos = [1, 0, -1, 0][dir] ?? 1;
    const sin = [0, 1, 0, -1][dir] ?? 0;
    el.push({ str, dir, along: e * cos + f * sin, across: -e * sin + f * cos });
  }
  el.sort((x, y) => x.dir - y.dir || y.across - x.across || x.along - y.along);
  const lines: Item[][] = [];
  for (const e of el) {
    const last = lines[lines.length - 1];
    const ref = last?.[0];
    if (last && ref && ref.dir === e.dir && Math.abs(ref.across - e.across) < 3) last.push(e);
    else lines.push([e]);
  }
  return lines.map((z) =>
    z
      .sort((x, y) => x.along - y.along)
      .map((e) => e.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
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

export async function textFromDocument(doc: PdfDocument, maxPages = 5): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(...linesFromItems(tc.items));
  }
  return out;
}
