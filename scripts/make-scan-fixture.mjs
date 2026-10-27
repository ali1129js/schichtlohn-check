// Builds a synthetic "scanned" payslip for the OCR tests: the made-up zvoove-style sample
// (Max Beispiel, fake numbers) is drawn into a PDF, rasterised at 150 dpi with poppler's
// pdftoppm, and wrapped again into an image-only PDF (no text layer).
// Usage: npm run sample:scan   (needs pdftoppm)
import { build } from "esbuild";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "scan-"));
await build({ entryPoints: ["tests/fixtures/synthetic.ts"], bundle: true, format: "esm", outfile: path.join(tmp, "synthetic.mjs"), logLevel: "error" });
const { zvooveItems } = await import(path.join(tmp, "synthetic.mjs"));

const W = 595.28, H = 841.89;
const doc = await PDFDocument.create();
const page = doc.addPage([W, H]);
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const it of zvooveItems()) page.drawText(it.str, { x: it.transform[4], y: it.transform[5], size: 9, font, color: rgb(0.1, 0.1, 0.1) });
const textPdf = path.join(tmp, "text.pdf");
writeFileSync(textPdf, await doc.save());
execFileSync("pdftoppm", ["-r", "150", "-gray", "-png", "-singlefile", textPdf, path.join(tmp, "scan")]);
const png = readFileSync(path.join(tmp, "scan.png"));
writeFileSync("tests/fixtures/scan-zvoove.png", png);

const scan = await PDFDocument.create();
scan.setCreationDate(new Date("2026-11-01T00:00:00Z"));
scan.setModificationDate(new Date("2026-11-01T00:00:00Z"));
const img = await scan.embedPng(png);
scan.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
writeFileSync("tests/fixtures/scan-zvoove.pdf", await scan.save());
console.log("tests/fixtures/scan-zvoove.png", png.length, "bytes");
