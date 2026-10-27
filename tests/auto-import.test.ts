import { describe, expect, it } from "vitest";
import { textLine, textLinesFromItems, type TextLine } from "@/import/pdfText";
import { assessQuality, joinHeaderLines, parsePayslipLines, tokNum } from "@/import/parser";
import { detectProfile } from "@/import/profiles";
import { importPayslipFile, sniffFile, type ImportStep } from "@/import/source";
import { HEIC_UNSUPPORTED } from "@/import/heic";
import { applyPreview, buildPreview } from "@/import/preview";
import { cleanOcrLine } from "@/ocr/words";
import { flattenIllumination } from "@/ocr/preprocess";
import { OCR_CONFIG, OcrConfigSchema } from "@/ocr/config";
import { applyOcrReliability } from "@/ocr/reliability";
import { calcMonth } from "@/lib/calc";
import { comparePayslip } from "@/lib/compare";
import { migrate } from "@/lib/storage";
import { PayslipSchema, SCHEMA_VERSION } from "@/lib/model";
import { lohnGehaltProItems, salaryMmYyyyItems } from "./fixtures/synthetic";
import { settings } from "./helpers";

const salary = () => parsePayslipLines(textLinesFromItems(salaryMmYyyyItems()));
const lgp = () => parsePayslipLines(textLinesFromItems(lohnGehaltProItems()));
const text = (items: { str: string }[]) => items.map((i) => i.str).join(" ");

describe("layout detection by score", () => {
  it("picks the MM.YYYY / Jahressummen layout for layout B", () => {
    const d = detectProfile(text(salaryMmYyyyItems()));
    expect(d.profile.id).toBe("lohn-gehaltsabrechnung-mmyyyy");
    expect(d.score).toBeGreaterThanOrEqual(4);
    expect(d.scores[0]!.id).toBe(d.profile.id);
    expect(d.scores.slice(1).every((s) => s.score < d.score)).toBe(true);
  });
  it("picks the lohn+gehalt layout for layout C", () => {
    const d = detectProfile(text(lohnGehaltProItems()));
    expect(d.profile.id).toBe("lexware-lohn-gehalt");
    expect(d.scores.find((s) => s.id === "datev")!.score).toBeLessThan(d.score);
  });
  it("falls back to the generic parser below the minimum score", () => {
    expect(detectProfile("Abrechnung Oktober Nettoverdienst").profile.id).toBe("generic");
  });
  it("both new profiles are flagged as not checked against a real payslip", () => {
    expect(salary().profile.checked).toBe(false);
    expect(lgp().profile.checked).toBe(false);
  });
});

describe("layout B: monthly salary with a Jahressummen column", () => {
  it("reads the month from MM.YYYY and detects salary", () => {
    const p = salary();
    expect(p.month?.value).toBe("2026-09");
    expect(p.payType).toBe("salary");
  });
  it("joins the two-line header and reads the month column, never the year column", () => {
    const p = salary();
    expect(p.table).toBe("columns");
    expect(p.lines.grundlohn?.amount).toBe(3200);
    expect(p.lines.grundlohn?.hours).toBeUndefined();
    expect(p.rows.some((r) => r.amount === 28800 || r.amount === 360 * 1)).toBe(false);
    expect(p.summary.gesamtbrutto?.value).toBe(3240);
    expect(p.summary.netto?.value).toBe(2186.4);
    expect(p.ytd.length).toBeGreaterThanOrEqual(2);
  });
  it("reads deductions, net and payout and checks them", () => {
    const p = salary();
    expect(p.summary.abzuege?.value).toBe(-1053.6);
    expect(p.summary.nettoAbzuege?.value).toBe(-2.4);
    expect(p.summary.auszahlung?.value).toBe(2184);
    const ids = Object.fromEntries(p.checks.map((c) => [c.id, c.ok]));
    expect(ids).toMatchObject({ gross: true, net: true, payout: true });
    expect(p.quality.level).toBe("sicher");
  });
  it("takes Steuer-/SV-Brutto from the Monat column of the WERTE block", () => {
    const p = salary();
    expect(p.summary.steuerbrutto?.value).toBe(3240);
    expect(p.summary.svbrutto?.value).toBe(3240);
  });
  it("salary payslips skip the per-hour, BZ and surcharge comparison", () => {
    const p = salary();
    const fields = buildPreview(p);
    const base = { lines: {} };
    const a = applyPreview(fields, base, p.payType);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.payslip.payType).toBe("salary");
    expect(a.payslip.netto).toBe(2186.4);
    const st = settings();
    const rows = comparePayslip(calcMonth([], "2026-09", st), a.payslip, st);
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain("branchenzuschlag");
    expect(keys).not.toContain("nacht");
    expect(rows.find((r) => r.key === "grundlohn")!.status).toBe("info");
    expect(rows.find((r) => r.key === "gesamtbrutto")!.status).toBe("ok");
    expect(rows.find((r) => r.key === "netto")!.status).toBe("ok");
  });
  it("a salary payslip whose rows do not add up shows a difference", () => {
    const st = settings();
    const rows = comparePayslip(calcMonth([], "2026-09", st), { payType: "salary", lines: { grundlohn: { amount: 3000 } }, gesamtbrutto: 3100 }, st);
    expect(rows.find((r) => r.key === "gesamtbrutto")!.status).toBe("diff");
  });
});

describe("layout C: lohn+gehalt, hourly", () => {
  it("detects hourly pay from the base line", () => {
    const p = lgp();
    expect(p.payType).toBe("hourly");
    expect(p.lines.grundlohn).toMatchObject({ hours: 160, rate: 15, amount: 2400 });
  });
  it("100 % holiday hours are paid holiday, not a +100 % surcharge", () => {
    const row = lgp().rows.find((r) => r.label.startsWith("Feiertagsstunden"))!;
    expect(row.category).toBe("holidayPay");
    expect(row.rate).toBe(15);
    expect(row.note).toMatch(/not a \+100 % surcharge/);
    expect(lgp().lines.feiertag?.amount).not.toBe(120);
  });
  it("a real Feiertagszuschlag stays a surcharge", () => {
    const p = lgp();
    expect(p.lines.feiertag).toMatchObject({ hours: 4, amount: 60 });
    expect(p.rows.find((r) => r.label === "Feiertagszuschlag")!.category).toBe("holiday");
  });
  it("Σ and Gesamtsumme rows are listed but never used as a line", () => {
    const p = lgp();
    expect(p.ignored.length).toBe(2);
    expect(p.rows.some((r) => r.amount === 2830 || r.amount === 887.4)).toBe(false);
  });
  it("uses the Σ row as gross only when no gross total is printed, marked 'check'", () => {
    const p = lgp();
    expect(p.summary.gesamtbrutto).toMatchObject({ value: 2830, confidence: "pruefen" });
    expect(p.summary.gesamtbrutto?.note).toMatch(/Σ row/);
    expect(p.checks.find((c) => c.id === "gross")?.ok).toBe(true);
    expect(p.quality.level).toBe("pruefen");
  });
  it("reads the Steuer / SV grid, net and payout from below their labels", () => {
    const p = lgp();
    expect(p.summary.steuerbrutto?.value).toBe(2720);
    expect(p.summary.steuerAbzuege?.value).toBe(310);
    expect(p.summary.svAbzuege?.value).toBe(577.4);
    expect(p.summary.netto?.value).toBe(1942.6);
    expect(p.summary.auszahlung?.value).toBe(1942.6);
    expect(p.checks.find((c) => c.id === "net")?.ok).toBe(true);
    expect(p.checks.find((c) => c.id === "payout")?.ok).toBe(true);
  });
  it("never uses the Aufgelaufene Jahreswerte block", () => {
    const p = lgp();
    expect(p.ytd.length).toBeGreaterThanOrEqual(4);
    const values = Object.values(p.summary).map((v) => v!.value);
    for (const y of [25470, 24570, 2790, 5196.6]) expect(values).not.toContain(y);
  });
  it("one-off payments and Boni are other lines", () => {
    const cats = Object.fromEntries(lgp().other.map((o) => [o.label, o.category]));
    expect(cats["Erfüllungs-Boni (Produktion)"]).toBe("oneOff");
  });
});

describe("parser helpers", () => {
  it("joinHeaderLines joins hyphen / slash header parts with the word below", () => {
    const j = joinHeaderLines(textLine("Lohn-    Stunden/  Zuschlags-"), textLine("art      Einheit   satz"))!;
    expect(j.tokens.map((t) => t.s)).toEqual(["Lohnart", "Stunden/Einheit", "Zuschlagssatz"]);
  });
  it("tokNum reads OCR forms of amounts", () => {
    expect(tokNum("1.234,56")).toBe(1234.56);
    expect(tokNum("„12,50")).toBe(12.5);
    expect(tokNum("12,50|")).toBe(12.5);
    expect(tokNum("1234.56")).toBe(1234.56);
    expect(tokNum("1.23456")).toBe(1234.56);
    expect(tokNum("9)")).toBeNull();
  });
  it("cleanOcrLine drops a leading border, turns noise into cell borders and joins split labels", () => {
    const l: TextLine = { text: "", ocr: true, tokens: [
      { s: "©", x: 0, w: 5 },
      { s: "Steuer", x: 10, w: 30 },
      { s: "-", x: 45, w: 5 },
      { s: "Brutto", x: 55, w: 30 },
      { s: "]", x: 100, w: 5 },
      { s: "KV-", x: 120, w: 15 },
      { s: "Brutto", x: 140, w: 30 },
    ] };
    expect(cleanOcrLine(l).tokens.map((t) => t.s)).toEqual(["Steuer-Brutto", "|", "KV-Brutto"]);
  });
  it("assessQuality: no gross total is 'uncertain'", () => {
    const p = parsePayslipLines(["Abrechnung 09.2026", "Lohnsteuer 100,00"]);
    expect(assessQuality(p).level).toBe("unsicher");
  });
  it("OCR caps the quality of every value at 'check'", () => {
    const lines = textLinesFromItems(salaryMmYyyyItems()).map((l) => ({ ...l, ocr: true, tokens: l.tokens.map((t) => ({ ...t, c: 95 })) }));
    const p = applyOcrReliability(parsePayslipLines(lines), lines, OCR_CONFIG.reliability);
    expect(p.summary.gesamtbrutto?.confidence).toBe("pruefen");
    expect(p.quality.level).not.toBe("sicher");
  });
});

describe("one automatic pipeline", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const HEIC = new Uint8Array([0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  const ocrLines = () => textLinesFromItems(salaryMmYyyyItems()).map((l) => ({ ...l, ocr: true, tokens: l.tokens.map((t) => ({ ...t, c: 93 })) }));
  const fakeOcr = (seen: { mime?: string } = {}) => async () => ({
    engine: { id: "tesseract" as const, name: "Fake" },
    recognizePdfPage: async () => ocrLines(),
    recognizeImage: async (_b: Uint8Array, mime: string) => {
      seen.mime = mime;
      return ocrLines();
    },
    terminate: async () => {},
  });
  it("detects the file type from the bytes, not the name", () => {
    expect(sniffFile(PNG)).toBe("png");
    expect(sniffFile(HEIC)).toBe("heic");
    expect(sniffFile(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]))).toBe("webp");
  });
  it("reports each step: type, OCR, layout, pay type, checks", async () => {
    const steps: ImportStep[] = [];
    const r = await importPayslipFile(PNG, "lohn.pdf", { ocr: fakeOcr(), onStatus: (s) => steps.push(s) });
    expect(r.fileKind).toBe("png");
    expect(steps.map((s) => s.id)).toEqual(["detect", "ocr", "layout", "paytype", "checks"]);
    expect(steps[0]!.label).toMatch(/PNG/);
    expect(steps[2]!.label).toMatch(/Recognised layout/);
    expect(steps[3]!.label).toMatch(/monthly salary/);
    expect(steps[4]!.label).toMatch(/Checks: 3 of 3 add up/);
  });
  it("converts HEIC before OCR when the browser can", async () => {
    const steps: string[] = [];
    const seen: { mime?: string } = {};
    await importPayslipFile(HEIC, "IMG.HEIC", {
      ocr: fakeOcr(seen),
      onStatus: (s) => steps.push(s.id),
      convertHeic: async () => ({ bytes: PNG, mime: "image/png" }),
    });
    expect(steps).toContain("heic");
    expect(seen.mime).toBe("image/png");
  });
  it("a HEIC photo the browser cannot open gets a clear message", async () => {
    await expect(
      importPayslipFile(HEIC, "IMG.HEIC", { ocr: fakeOcr(), convertHeic: async () => Promise.reject(new Error(HEIC_UNSUPPORTED)) })
    ).rejects.toThrow(/cannot open HEIC/);
  });
  it("rejects files that are neither a PDF nor an image", async () => {
    await expect(importPayslipFile(new Uint8Array(40).fill(65), "x.txt", { ocr: fakeOcr() })).rejects.toThrow(/not a PDF or an image/);
  });
});

describe("photo preprocessing and config", () => {
  it("flattenIllumination evens out a lighting gradient", () => {
    const w = 64, h = 64;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 120 + x; // dark left, bright right
    flattenIllumination(g, w, h, 8);
    const left = g[32 * w + 10]!, right = g[32 * w + 54]!;
    expect(Math.abs(left - right)).toBeLessThan(15);
  });
  it("the shipped config turns flattening on for photos, without a threshold", () => {
    expect(OCR_CONFIG.preprocess.photos).toEqual({ flatten: true, threshold: "none" });
    expect(OcrConfigSchema.safeParse({ ...OCR_CONFIG, preprocess: { ...OCR_CONFIG.preprocess, photos: { flatten: "yes", threshold: "none" } } }).success).toBe(false);
  });
});

describe("saved data schema 3", () => {
  it("migrates schema 2 to 3 without touching payslips", () => {
    const v2 = { schemaVersion: 2, settings: settings(), shifts: [], payslips: { "2026-01": { lines: { grundlohn: { amount: 100 } }, gesamtbrutto: 100 } }, labelMap: {} };
    const r = migrate(v2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
    expect((r.data as typeof v2).payslips["2026-01"]).toEqual(v2.payslips["2026-01"]);
  });
  it("a payslip may carry the pay type and the printed net figures", () => {
    expect(PayslipSchema.safeParse({ lines: {}, payType: "salary", abzuege: -10, netto: 90, auszahlung: 90 }).success).toBe(true);
    expect(PayslipSchema.safeParse({ lines: {}, payType: "weekly" }).success).toBe(false);
  });
});
