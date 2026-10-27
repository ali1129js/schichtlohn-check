import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorker } from "tesseract.js";
import { textLine, textLinesFromItems, type TextLine } from "@/import/pdfText";
import { importPayslipFile, sniffFile } from "@/import/source";
import { OCR_CONFIG, OcrConfigSchema } from "@/ocr/config";
import type { OcrSession } from "@/ocr/types";
import { ownAsset } from "@/ocr/assets";
import { otsu, preprocess } from "@/ocr/preprocess";
import { textLayerQuality } from "@/ocr/quality";
import { applyOcrReliability, ocrLevel } from "@/ocr/reliability";
import { ocrBlocksToLines, type OcrBlock } from "@/ocr/words";
import { parsePayslipLines } from "@/import/parser";
import { buildPreview } from "@/import/preview";
import { zvooveItems } from "./fixtures/synthetic";
import { fixture, nodePdfJs } from "./helpers";

const TL = OCR_CONFIG.textLayer;
const zvLines = () => textLinesFromItems(zvooveItems());

describe("text layer or scan?", () => {
  it("a normal text layer is used as it is", () => {
    expect(textLayerQuality(zvLines(), TL)).toMatchObject({ ok: true });
  });
  it("an empty page is a scan", () => {
    expect(textLayerQuality([], TL)).toMatchObject({ ok: false, reason: "no text layer (scan or photo)" });
  });
  it("a garbled text layer (broken font encoding) goes to OCR", () => {
    const garbage = Array.from({ length: 12 }, () => textLine("\u0003\u0007\uFFFD\u00ad\u0015\u2023\u25a1\u0012 \u0001\u0002\u0003\u0004\u0005"));
    expect(textLayerQuality(garbage, TL).ok).toBe(false);
  });
  it("text without amounts or payslip words goes to OCR", () => {
    const lines = Array.from({ length: 5 }, () => textLine("Lorem ipsum dolor sit amet consectetur"));
    expect(textLayerQuality(lines, TL)).toMatchObject({ ok: false });
  });
  it("recognises file types by their bytes", () => {
    expect(sniffFile(fixture("sample-payslip.pdf"))).toBe("pdf");
    expect(sniffFile(fixture("scan-zvoove.png"))).toBe("png");
    expect(sniffFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffFile(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0]))).toBe("heic");
    expect(sniffFile(new TextEncoder().encode("hello"))).toBe("unknown");
  });
});

describe("OCR reliability", () => {
  const R = OCR_CONFIG.reliability;
  it.each([
    ["sicher", 95, "pruefen"],
    ["sicher", R.pruefenMinConfidence, "pruefen"],
    ["sicher", R.pruefenMinConfidence - 1, "unsicher"],
    ["pruefen", 99, "pruefen"],
    ["unsicher", 99, "unsicher"],
    ["sicher", null, "unsicher"],
  ] as const)("parser %s + word confidence %s -> %s (never sicher)", (parser, conf, out) => {
    expect(ocrLevel(parser, conf, R)).toBe(out);
  });

  it("marks every value with its origin and the word confidence", () => {
    const lines: TextLine[] = zvLines().map((l) => ({ ...l, ocr: true, tokens: l.tokens.map((t: TextLine["tokens"][number]) => ({ ...t, c: /2\.412/.test(t.s) ? 60 : 93 })) }));
    const p = applyOcrReliability(parsePayslipLines(lines), lines, R);
    expect(p.lines.grundlohn).toMatchObject({ origin: "ocr", ocrConfidence: 60, confidence: "unsicher" });
    expect(p.lines.nacht).toMatchObject({ origin: "ocr", ocrConfidence: 93, confidence: "pruefen" });
    const all = [...Object.values(p.lines), ...Object.values(p.summary)];
    expect(all.every((v) => (v as { confidence: string }).confidence !== "sicher")).toBe(true);
    const f = buildPreview(p);
    expect(f.find((x) => x.id === "grundlohn.amount")).toMatchObject({ origin: "ocr", selected: false });
  });

  it("text-layer values stay untouched", () => {
    const lines = zvLines();
    const p = parsePayslipLines(lines);
    expect(applyOcrReliability(p, lines, R)).toBe(p);
  });
});

describe("OCR helpers", () => {
  it("Otsu separates ink from paper and preprocess binarises RGBA pixels", () => {
    const gray = new Uint8Array([20, 25, 30, 220, 230, 240, 235, 225]);
    const t = otsu(gray);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
    const data = new Uint8ClampedArray([10, 10, 10, 255, 240, 240, 240, 255]);
    preprocess({ data, width: 2, height: 1 }, { grayscale: true, threshold: "otsu" });
    expect([data[0], data[4]]).toEqual([0, 255]);
  });
  it("turns OCR boxes into lines with word confidence, scaled to print size", () => {
    const w = (text: string, x0: number, conf: number) => ({ text, confidence: conf, bbox: { x0, y0: 100, x1: x0 + 20 * text.length, y1: 133 } });
    const blocks: OcrBlock[] = [{ paragraphs: [{ lines: [{ bbox: { x0: 0, y0: 100, x1: 900, y1: 133 }, words: [w("Normalstunden", 100, 91), w("2.412,00", 1400, 77)] }] }] }];
    const [l] = ocrBlocksToLines(blocks);
    expect(l).toMatchObject({ text: "Normalstunden 2.412,00", ocr: true });
    expect(l!.tokens.map((t) => t.c)).toEqual([91, 77]);
    expect(l!.tokens[1]!.x).toBeCloseTo((1400 * 8) / 33, 1);
  });
  it("OCR assets come only from this site", () => {
    expect(OcrConfigSchema.safeParse(OCR_CONFIG).success).toBe(true);
    expect(ownAsset(OCR_CONFIG.engines.tesseract.assets.workerPath, "https://app.example/x/")).toBe("https://app.example/x/ocr/worker.min.js");
    expect(() => ownAsset("https://cdn.jsdelivr.net/npm/x.js", "https://app.example/")).toThrow();
    expect(() => ownAsset("//cdn.example/x.js", "https://app.example/")).toThrow();
    const t = OCR_CONFIG.engines.tesseract;
    const bad = { ...OCR_CONFIG, engines: { ...OCR_CONFIG.engines, tesseract: { ...t, assets: { ...t.assets, langPath: "https://cdn.example/lang/" } } } };
    expect(OcrConfigSchema.safeParse(bad).success).toBe(false);
  });
});

/** Real tesseract.js (deu, the same language data the app serves) in Node. */
function nodeTesseract(): () => Promise<OcrSession> {
  return async () => {
    const worker = await createWorker("deu", 1, { langPath: path.resolve("node_modules/@tesseract.js-data/deu/4.0.0_best_int"), gzip: true, cacheMethod: "none" });
    const run = async (img: Buffer) => ocrBlocksToLines((await worker.recognize(img, {}, { blocks: true })).data.blocks as unknown as OcrBlock[]);
    return {
      engine: { id: "tesseract", name: "Tesseract (deu)" },
      recognizeImage: (bytes: Uint8Array) => run(Buffer.from(bytes)),
      // Node has no canvas: the scan PDF holds exactly this image
      recognizePdfPage: () => run(Buffer.from(fixture("scan-zvoove.png"))),
      terminate: async () => void (await worker.terminate()),
    };
  };
}

describe("synthetic scanned payslip, read by real OCR", () => {
  it("a photo (PNG) is read by OCR; no value is 'sicher'; the totals are cross-checked", async () => {
    const r = await importPayslipFile(fixture("scan-zvoove.png"), "foto.png", { ocr: nodeTesseract() });
    expect(r.method).toBe("ocr");
    expect(r.ocrEngine?.id).toBe("tesseract");
    expect(r.ocrConfidence).toBeGreaterThan(50);
    const p = r.parsed;
    expect(p.profile.id).toBe("zvoove");
    expect(p.lines.grundlohn?.amount).toBe(2412);
    expect(p.summary.gesamtbrutto?.value).toBe(3582.48);
    const values = [...Object.values(p.lines), ...Object.values(p.summary)];
    expect(values.length).toBeGreaterThan(5);
    for (const v of values) {
      expect(v!.origin).toBe("ocr");
      expect(v!.confidence).not.toBe("sicher");
    }
    expect(p.checks.find((c) => c.id === "gross")).toBeDefined();
  }, 120_000);

  it("a scanned PDF page without text layer goes to OCR automatically", async () => {
    const r = await importPayslipFile(fixture("scan-zvoove.pdf"), "scan.pdf", { pdfjs: nodePdfJs, ocr: nodeTesseract() });
    expect(r.pages).toEqual([{ page: 1, method: "ocr", reason: "no text layer (scan or photo)" }]);
    expect(r.parsed.lines.grundlohn?.origin).toBe("ocr");
  }, 120_000);

  it("a text PDF never starts OCR", async () => {
    let started = false;
    const r = await importPayslipFile(fixture("sample-payslip.pdf"), "s.pdf", {
      pdfjs: nodePdfJs,
      ocr: async () => {
        started = true;
        throw new Error("no");
      },
    });
    expect(started).toBe(false);
    expect(r.method).toBe("text");
    expect(r.ocrConfidence).toBeNull();
  });

  it("without OCR an image is refused with a clear message", async () => {
    await expect(importPayslipFile(fixture("scan-zvoove.png"), "f.png")).rejects.toThrow(/image/);
  });
});

describe("OCR engines (pluggable, chosen by config)", () => {
  it("document AI is experimental: used only with WebGPU and the user's consent", async () => {
    const { planEngines } = await import("@/ocr/engines");
    expect(planEngines(OCR_CONFIG, { webgpu: true, optIn: {} }).use).toEqual(["tesseract"]);
    expect(planEngines(OCR_CONFIG, { webgpu: false, optIn: { graniteDocling: true } }).skipped[0]).toMatchObject({ id: "graniteDocling", reason: "this browser has no WebGPU" });
    expect(planEngines(OCR_CONFIG, { webgpu: true, optIn: { graniteDocling: true } }).use).toEqual(["graniteDocling", "tesseract"]);
  });
  it("falls back to Tesseract when the preferred engine cannot start", async () => {
    const { startOcr, ENGINES } = await import("@/ocr/engines");
    const fake = { engine: { id: "tesseract" as const, name: "T" }, recognizePdfPage: async () => [], recognizeImage: async () => [], terminate: async () => {} };
    const s = await startOcr(OCR_CONFIG, { webgpu: true, optIn: { graniteDocling: true } }, undefined, { ...ENGINES, tesseract: { ...ENGINES.tesseract, create: async () => fake } });
    expect(s.engine.id).toBe("tesseract");
  });
  it("a disabled engine is skipped", async () => {
    const { planEngines } = await import("@/ocr/engines");
    const cfg = { ...OCR_CONFIG, engines: { ...OCR_CONFIG.engines, tesseract: { ...OCR_CONFIG.engines.tesseract, enabled: false } } };
    expect(planEngines(cfg, { webgpu: false, optIn: {} }).use).toEqual([]);
  });
});
