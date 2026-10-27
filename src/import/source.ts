import { foundCount, parsePayslipLines, type ParsedPayslip } from "./parser";
import { installPolyfills } from "./polyfills";
import { openPdf, PdfImportError, textFromDocument, type PdfJsLib } from "./pdfText";

/**
 * Payslip PDF import. Everything runs in this browser tab: pdf.js is loaded lazily from the
 * app's own bundle (separate chunk, worker bundled via Vite `?url`), the file is read with
 * File.arrayBuffer() and nothing is uploaded. The production build also sets
 * Content-Security-Policy connect-src 'none', so a network request would be blocked anyway.
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
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

export async function importPayslipPdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  pdfjsLoader: () => Promise<PdfJsLib> = loadPdfJs
): Promise<ImportedPayslip> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfImportError("too-big", "The file is larger than 15 MB. Payslip PDFs are usually much smaller.");
  if (!looksLikePdf(bytes)) throw new PdfImportError("not-pdf", `"${fileName}" is not a PDF file.`);
  const doc = await openPdf(bytes, await pdfjsLoader());
  let text: string[];
  try {
    text = await textFromDocument(doc);
  } finally {
    await doc.destroy?.();
  }
  if (text.join("").replace(/\s/g, "").length < MIN_TEXT_CHARS)
    throw new PdfImportError(
      "no-text",
      "This PDF contains no readable text: it is probably a scan or a photo. Text recognition (OCR) is not available yet, so please type the amounts in by hand."
    );
  const parsed = parsePayslipLines(text);
  if (foundCount(parsed) === 0)
    throw new PdfImportError("no-payslip", "Text was found, but no payslip lines were recognised. Please type the amounts in by hand.");
  return { fileName, parsed, text };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
