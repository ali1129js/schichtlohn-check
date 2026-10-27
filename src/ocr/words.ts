import { textLinesFromItems, type TextLine } from "@/import/pdfText";

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
  return textLinesFromItems(items);
}

export function meanConfidence(lines: TextLine[]): number | null {
  const c = lines.flatMap((l) => l.tokens.map((t) => t.c)).filter((x): x is number => x !== undefined);
  return c.length ? Math.round(c.reduce((a, b) => a + b, 0) / c.length) : null;
}
