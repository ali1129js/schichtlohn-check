import type { LabelMap } from "./categories";
import { foundCount, parsePayslipLines, type ParsedPayslip } from "./parser";
import { installPolyfills } from "./polyfills";
import { openPdf, pdfProducer, PdfImportError, textPagesFromDocument, type PdfJsLib, type TextLine } from "./pdfText";
import { OCR_CONFIG, type OcrConfig } from "@/ocr/config";
import type { OcrSession } from "@/ocr/types";
import { textLayerQuality } from "@/ocr/quality";
import { applyOcrReliability } from "@/ocr/reliability";
import { meanConfidence } from "@/ocr/words";

/**
 * Payslip PDF import. Everything runs in this browser tab: pdf.js is loaded lazily from the
 * app's own bundle (separate chunk, worker bundled via Vite `?url`), the file is read with
 * File.arrayBuffer() and nothing is uploaded. Scans and photos are read by OCR (tesseract.js),
 * also served from this site. The production build sets Content-Security-Policy
 * connect-src 'self', so a request to any other host would be blocked anyway.
 */
export async function loadPdfJs(): Promise<PdfJsLib> {
  installPolyfills();
  // legacy build: works on older phone browsers too
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.min.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfJsLib;
}

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** fewer non-space characters than this = no usable text layer (scan / photo) */
export const MIN_TEXT_CHARS = 20;

export interface ImportedPayslip {
  fileName: string;
  parsed: ParsedPayslip;
  /** the extracted text lines, for the "show text" disclosure */
  text: string[];
  /** the same lines with word positions, to parse again after the user changes a category */
  lines: TextLine[];
  producer: string;
  /** how the text was obtained: PDF text layer, OCR, or both (page by page) */
  method: "text" | "ocr" | "mixed";
  pages: { page: number; method: "text" | "ocr"; reason?: string }[];
  /** mean OCR word confidence 0-100 */
  ocrConfidence: number | null;
  /** the recognition engine that read the scanned pages */
  ocrEngine: { id: string; name: string } | null;
}

export type FileKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | "unknown";

export function sniffFile(bytes: Uint8Array): FileKind {
  const b = bytes;
  if (looksLikePdf(b)) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length > 12 && ascii(4, 8) === "ftyp" && /^(?:heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return "heic";
  return "unknown";
}

const MIME: Record<Exclude<FileKind, "pdf" | "unknown">, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export interface ImportOptions {
  pdfjs?: () => Promise<PdfJsLib>;
  /** text recognition; without it, scans are rejected with a clear message */
  ocr?: () => Promise<OcrSession>;
  labelMap?: LabelMap;
  config?: OcrConfig;
}

/**
 * Import any payslip file: PDFs are read from their text layer page by page; pages without a
 * usable text layer (scans, broken fonts) and photos (JPG/PNG/WebP/HEIC) go through OCR.
 */
export async function importPayslipFile(data: ArrayBuffer | Uint8Array, fileName: string, opts: ImportOptions = {}): Promise<ImportedPayslip> {
  const cfg = opts.config ?? OCR_CONFIG;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfImportError("too-big", "The file is larger than 15 MB. Payslips are usually much smaller.");
  const kind = sniffFile(bytes);
  const pages: ImportedPayslip["pages"] = [];
  let lines: TextLine[] = [];
  let producer = "";
  let ocr: OcrSession | undefined;
  let ocrEngine: ImportedPayslip["ocrEngine"] = null;
  const getOcr = async () => {
    ocr ??= await opts.ocr!();
    ocrEngine = ocr.engine;
    return ocr;
  };
  try {
    if (kind === "pdf") {
      const doc = await openPdf(bytes, await (opts.pdfjs ?? loadPdfJs)());
      try {
        const textPages = await textPagesFromDocument(doc, cfg.maxPages);
        producer = await pdfProducer(doc);
        for (let i = 0; i < textPages.length; i++) {
          const q = textLayerQuality(textPages[i]!, cfg.textLayer);
          if (q.ok || !opts.ocr) {
            pages.push({ page: i + 1, method: "text", ...(q.reason ? { reason: q.reason } : {}) });
            lines.push(...textPages[i]!);
            continue;
          }
          const o = await getOcr();
          pages.push({ page: i + 1, method: "ocr", reason: q.reason });
          lines.push(...(await o.recognizePdfPage(await doc.getPage(i + 1), i + 1)));
        }
      } finally {
        await doc.destroy?.();
      }
    } else if (kind !== "unknown") {
      if (!opts.ocr) throw new PdfImportError("not-pdf", `"${fileName}" is an image; text recognition is not available here.`);
      const o = await getOcr();
      pages.push({ page: 1, method: "ocr", reason: "photo or image file" });
      lines = await o.recognizeImage(bytes, MIME[kind]);
    } else throw new PdfImportError("not-pdf", `"${fileName}" is not a PDF or an image (JPG, PNG, WebP, HEIC).`);
  } finally {
    await ocr?.terminate();
  }
  const text = lines.map((l) => l.text);
  const usedOcr = pages.some((p) => p.method === "ocr");
  if (text.join("").replace(/\s/g, "").length < MIN_TEXT_CHARS)
    throw new PdfImportError(
      "no-text",
      usedOcr
        ? "Text recognition found (almost) no text. Use a sharper, straight photo in good light, or type the amounts in by hand."
        : "This PDF contains no readable text: it is probably a scan or a photo. Please type the amounts in by hand."
    );
  let parsed = parsePayslipLines(lines, { labelMap: opts.labelMap ?? {}, producer });
  if (usedOcr) parsed = applyOcrReliability(parsed, lines, cfg.reliability);
  if (foundCount(parsed) === 0)
    throw new PdfImportError("no-payslip", "Text was found, but no payslip lines were recognised. Please type the amounts in by hand.");
  const method = !usedOcr ? "text" : pages.every((p) => p.method === "ocr") ? "ocr" : "mixed";
  return { fileName, parsed, text, lines, producer, method, pages, ocrConfidence: usedOcr ? meanConfidence(lines.filter((l) => l.ocr)) : null, ocrEngine };
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/** PDF import from the text layer only (no OCR): kept for callers and tests. */
export async function importPayslipPdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  pdfjsLoader: () => Promise<PdfJsLib> = loadPdfJs,
  labelMap: LabelMap = {}
): Promise<ImportedPayslip> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength <= MAX_PDF_BYTES && !looksLikePdf(bytes)) throw new PdfImportError("not-pdf", `"${fileName}" is not a PDF file.`);
  return importPayslipFile(bytes, fileName, { pdfjs: pdfjsLoader, labelMap });
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
