import { textLinesFromItems, type TextLine, type Token } from "@/import/pdfText";

/** The part of tesseract.js' result we use (blocks -> paragraphs -> lines -> words). */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBox;
}
export interface OcrLine {
  words: OcrWord[];
  bbox: OcrBox;
}
export interface OcrBlock {
  paragraphs: { lines: OcrLine[] }[];
}

/** typical height (PDF points) of a word's box on a printed payslip, used to scale OCR pixels */
const WORD_HEIGHT_PT = 8;

/**
 * OCR words -> text lines in PDF-like units, so the same column logic works for scans: pixel
 * positions are scaled so the median word height matches printed text, whatever the dpi.
 * Each word keeps its confidence.
 */
export function ocrBlocksToLines(blocks: OcrBlock[] | null | undefined): TextLine[] {
  const lines = (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).filter((l) => l.words.length);
  const heights = lines
    .flatMap((l) => l.words.map((w) => w.bbox.y1 - w.bbox.y0))
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? WORD_HEIGHT_PT;
  const k = median / WORD_HEIGHT_PT;
  const items = lines.flatMap((l) =>
    l.words
      .filter((w) => w.text.trim())
      .map((w) => ({
        str: w.text,
        transform: [10, 0, 0, 10, w.bbox.x0 / k, -l.bbox.y1 / k],
        width: Math.max(1, (w.bbox.x1 - w.bbox.x0) / k),
        conf: Math.round(w.confidence),
      }))
  );
  return textLinesFromItems(items).map(cleanOcrLine).filter((l) => l.tokens.length);
}

/** table borders and specks that OCR reads as characters: kept as a "|" cell border */
const NOISE = /^[|\\[\]{}©®»«_~¦•·]+$/;

/**
 * Turns border noise ("©", "]") into "|" cell borders and joins words split around a hyphen, which OCR often reads
 * as separate words: "Steuer - Brutto" and "KV- Brutto" become "Steuer-Brutto" / "KV-Brutto",
 * so a label is never cut into "Steuer" and a stray "Brutto".
 */
export function cleanOcrLine(l: TextLine): TextLine {
  const toks = l.tokens
    .map((t) => (NOISE.test(t.s) ? { ...t, s: "|" } : t))
    .filter((t, i, a) => !(t.s === "|" && (i === 0 || a[i - 1]!.s === "|")));
  const out: Token[] = [];
  const near = (a: Token, b: Token) => b.x - (a.x + a.w) <= 12;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = out[out.length - 1];
    const next = toks[i + 1];
    const word = (s: string) => /[A-Za-zÄÖÜäöüß]$/.test(s);
    if (prev && next && t.s === "-" && word(prev.s) && /^[A-Za-zÄÖÜäöüß]/.test(next.s) && near(prev, t) && near(t, next)) {
      out[out.length - 1] = merge(prev, next, "-");
      i++;
      continue;
    }
    if (prev && /[A-Za-zÄÖÜäöüß]-$/.test(prev.s) && /^[A-ZÄÖÜ][a-zäöüß]+$/.test(t.s) && t.x - (prev.x + prev.w) <= 10) {
      out[out.length - 1] = merge(prev, t, "");
      continue;
    }
    out.push(t);
  }
  return { ...l, text: out.map((t) => t.s).join(" "), tokens: out };
}

function merge(a: Token, b: Token, sep: string): Token {
  const c = a.c !== undefined && b.c !== undefined ? Math.min(a.c, b.c) : (a.c ?? b.c);
  return { s: a.s + sep + b.s, x: a.x, w: b.x + b.w - a.x, ...(c !== undefined ? { c } : {}) };
}

export function meanConfidence(lines: TextLine[]): number | null {
  const c = lines.flatMap((l) => l.tokens.map((t) => t.c)).filter((x): x is number => x !== undefined);
  return c.length ? Math.round(c.reduce((a, b) => a + b, 0) / c.length) : null;
}
