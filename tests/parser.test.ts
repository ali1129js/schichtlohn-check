import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseGermanNumber, parsePayslipLines, splitRow } from "@/import/parser";
import { linesFromItems, PdfImportError, type PdfJsLib } from "@/import/pdfText";
import { applyPreview, buildPreview, parseEdited } from "@/import/preview";
import { base64ToBytes, importPayslipPdf } from "@/import/source";
import { SAMPLE_PAYSLIP_PDF_BASE64 } from "@/import/samplePayslipPdf";
import { emptyPayslip } from "@/lib/model";
import { fixture, nodePdfJs } from "./helpers";

describe("German numbers", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["3.501,48", 3501.48],
    ["152,00", 152],
    ["0,00", 0],
    ["-10,00", -10],
    ["+6,00", 6],
    ["20", 20],
    ["14,50 €", 14.5],
    ["1.000.000,01", 1000000.01],
  ])("%s -> %s", (s, n) => expect(parseGermanNumber(s)).toBe(n));
  it.each(["abc", "1,2,3", "12.34", "1.23,4.5", ""])("rejects %s", (s) => expect(parseGermanNumber(s)).toBeNull());
  it("edited values accept German and dot decimals", () => {
    expect(parseEdited("1.234,56")).toBe(1234.56);
    expect(parseEdited("1234.56")).toBe(1234.56);
    expect(parseEdited("16,68 €")).toBe(16.68);
    expect(parseEdited("x")).toBeNull();
  });
});

describe("table rows", () => {
  it("separates description numbers from the amount columns and strips St/SV flags", () => {
    expect(splitRow("1100 Branchenzuschlag Chemie (TV BZ, Stufe 2, 15%) 152,00 2,18 331,36 L L")).toEqual({
      code: "1100",
      description: "Branchenzuschlag Chemie (TV BZ, Stufe 2, 15%)",
      numbers: [152, 2.18, 331.36],
      unit: undefined,
    });
    expect(splitRow("1600 Fahrgeld (steuerfrei) 20 Tage 3,00 60,00 F F")).toMatchObject({ numbers: [20, 3, 60], unit: "Tage" });
  });
});

describe("sample payslip PDF (made up: Max Beispiel, Musterzeit Personal GmbH)", () => {
  it("extracts and parses every field with confidence 'sicher'", async () => {
    const r = await importPayslipPdf(fixture("sample-payslip.pdf"), "sample.pdf", nodePdfJs);
    const p = r.parsed;
    expect(p.month).toMatchObject({ value: "2026-03", confidence: "sicher" });
    expect(p.lines.grundlohn).toMatchObject({ hours: 152, rate: 14.5, amount: 2204, confidence: "sicher" });
    expect(p.lines.branchenzuschlag).toMatchObject({ hours: 152, rate: 2.18, amount: 331.36, confidence: "sicher" });
    expect(p.lines.mehrarbeit).toMatchObject({ hours: 6, rate: 3.63, amount: 21.78, confidence: "sicher" });
    expect(p.lines.nacht).toMatchObject({ hours: 40, rate: 4.17, amount: 166.8, confidence: "sicher" });
    expect(p.lines.sonntag).toMatchObject({ hours: 16, rate: 8.34, amount: 133.44, confidence: "sicher" });
    expect(p.lines.feiertag).toMatchObject({ hours: 8, rate: 20.85, amount: 166.8, confidence: "sicher" });
    expect(p.lines.tarifurlaub).toMatchObject({ hours: 15, rate: 16.7, amount: 250.5, confidence: "sicher" });
    expect(p.lines.freizeit).toMatchObject({ hours: 10, rate: 16.68, amount: 166.8, confidence: "sicher" });
    expect(p.lines.fahrgeld).toMatchObject({ rate: 3, amount: 60, unit: "Tage", confidence: "sicher" });
    expect(p.lines.fahrgeld?.hours).toBeUndefined();
    expect(p.summary.gesamtbrutto).toMatchObject({ value: 3501.48, confidence: "sicher" });
    expect(p.summary.steuerfrei).toMatchObject({ value: 527.04, confidence: "sicher" });
    expect(p.summary.azkSaldo).toMatchObject({ value: 28.5, confidence: "sicher" });
    expect(p.summary.stundenlohn?.value).toBe(14.5);
    const info = Object.fromEntries(p.info.map((i) => [i.label, i.value]));
    expect(info).toMatchObject({
      Arbeitnehmer: "Max Beispiel",
      Einsatzbetrieb: "Beispiel Pharma AG",
      Tarif: "GVP/DGB",
      Entgeltgruppe: "EG 2",
      Lohnsteuer: "342,50",
      Auszahlung: "3.067,34",
      "Gesetzliches Netto": "2.540,30",
    });
    expect(p.ytd).toHaveLength(1);
    expect(p.ytd[0]).toMatch(/kumuliert/);
    expect(p.unmatched).toEqual([]);
  });

  it("the bundled 'Try sample' PDF is the same file as the test fixture", () => {
    expect(Buffer.from(base64ToBytes(SAMPLE_PAYSLIP_PDF_BASE64)).equals(Buffer.from(fixture("sample-payslip.pdf")))).toBe(true);
  });

  it("the sample lines add up to its Gesamtbrutto and steuerfrei totals", async () => {
    const p = (await importPayslipPdf(fixture("sample-payslip.pdf"), "s.pdf", nodePdfJs)).parsed;
    const sum = Object.values(p.lines).reduce((a, l) => a + (l?.amount ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(3501.48);
    const free = ["nacht", "sonntag", "feiertag", "fahrgeld"] as const;
    expect(Math.round(free.reduce((a, k) => a + p.lines[k]!.amount!, 0) * 100) / 100).toBe(527.04);
  });

  it("preview -> apply fills the payslip-compare fields; unselected and edited values are respected", async () => {
    const p = (await importPayslipPdf(fixture("sample-payslip.pdf"), "s.pdf", nodePdfJs)).parsed;
    const fields = buildPreview(p);
    expect(fields.every((f) => f.selected)).toBe(true);
    const night = fields.find((f) => f.id === "nacht.amount")!;
    night.text = "170,00";
    fields.find((f) => f.id === "fahrgeld.amount")!.selected = false;
    const base = { ...emptyPayslip(), lines: { fahrgeld: { amount: 1 } } };
    const r = applyPreview(fields, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payslip.lines.nacht).toEqual({ hours: 40, rate: 4.17, amount: 170 });
    expect(r.payslip.lines.fahrgeld?.amount).toBe(1);
    expect(r.payslip.gesamtbrutto).toBe(3501.48);
    expect(r.payslip.azkSaldo).toBe(28.5);
  });

  it("apply refuses non-numeric edits", () => {
    const fields = buildPreview(parsePayslipLines(["1000 Normalstunden 10,00 14,50 145,00"]));
    fields[0]!.text = "zehn";
    expect(applyPreview(fields, emptyPayslip())).toMatchObject({ ok: false });
  });
});

describe("layout variants (rule-based)", () => {
  it("recognises alternative names and a semicolon-joined summary line", () => {
    const p = parsePayslipLines([
      "Abrechnungszeitraum: März 2026",
      "010 Grundlohn 151,67 15,33 2.325,10",
      "020 Branchenzuschlag 151,67 2,30 348,84",
      "030 Überstunden 25 % 4,00 4,41 17,64",
      "040 Zuschlag Nachtarbeit 25% 20,00 4,41 88,20",
      "041 Nachtzuschlag 40% 8,00 7,05 56,40",
      "050 Sonntagszuschlag 8,00 8,82 70,56",
      "060 Urlaubsentgelt 7,00 17,63 123,41",
      "070 Fahrtkosten 60,00",
      "Summen: Gesamtbrutto 3.030,15; davon steuerfrei 215,16; Lohnsteuer 300,00; Auszahlung 2.100,00",
      "Netto kumuliert 12.000,00",
      "Stpfl. Brutto kumuliert 20.000,00",
    ]);
    expect(p.month?.value).toBe("2026-03");
    expect(p.lines.grundlohn).toMatchObject({ hours: 151.67, amount: 2325.1, confidence: "sicher" });
    expect(p.lines.mehrarbeit?.amount).toBe(17.64);
    // two night lines are added up and flagged for checking
    expect(p.lines.nacht).toMatchObject({ hours: 28, amount: 144.6, confidence: "pruefen" });
    expect(p.lines.tarifurlaub?.amount).toBe(123.41);
    expect(p.lines.fahrgeld).toMatchObject({ amount: 60, confidence: "pruefen" });
    expect(p.summary.gesamtbrutto?.value).toBe(3030.15);
    expect(p.summary.steuerfrei?.value).toBe(215.16);
    expect(p.ytd).toHaveLength(2);
    expect(p.info.find((i) => i.label === "Auszahlung")?.value).toBe("2.100,00");
  });

  it("flags a row whose hours x rate do not match the amount", () => {
    const p = parsePayslipLines(["1300 Nachtzuschlag 25% 40,00 4,17 170,00 F F"]);
    expect(p.lines.nacht?.confidence).toBe("pruefen");
    expect(p.lines.nacht?.note).toMatch(/does not match/);
  });

  it("marks the base rate 'unsicher' if the header Stundenlohn disagrees", () => {
    const p = parsePayslipLines(["Stundenlohn: 15,00", "1000 Normalstunden 10,00 14,50 145,00"]);
    expect(p.lines.grundlohn?.confidence).toBe("unsicher");
    expect(buildPreview(p).find((f) => f.id === "grundlohn.rate")?.selected).toBe(false);
  });

  it("does not mistake 'Freizeitauszahlung' for the net 'Auszahlung' or 'steuerfrei)' in a row for the total", () => {
    const p = parsePayslipLines(["1500 Freizeitauszahlung (AZK) 10,00 16,68 166,80 L L", "1300 Nachtzuschlag 25% (§3b steuerfrei) 40,00 4,17 166,80 F F"]);
    expect(p.lines.freizeit?.amount).toBe(166.8);
    expect(p.summary.steuerfrei).toBeUndefined();
    expect(p.info.find((i) => i.label === "Auszahlung")).toBeUndefined();
  });

  it("guesses the month from a date with low confidence if there is no label", () => {
    expect(parsePayslipLines(["Abrechnung 04/2026"]).month).toMatchObject({ value: "2026-04", confidence: "unsicher" });
  });
});

describe("PDF text extraction", () => {
  const item = (str: string, x: number, y: number) => ({ str, transform: [10, 0, 0, 10, x, y] });
  it("groups items into lines and sorts left to right", () => {
    expect(linesFromItems([item("152,00", 300, 500.5), item("1000", 10, 500), item("Normalstunden", 60, 500), item("Summen", 10, 480)])).toEqual([
      "1000 Normalstunden 152,00",
      "Summen",
    ]);
  });

  it("a scanned PDF without a text layer gives a clear 'no-text' error", async () => {
    const err = await importPayslipPdf(fixture("scanned-no-text.pdf"), "scan.pdf", nodePdfJs).catch((e) => e);
    expect(err).toBeInstanceOf(PdfImportError);
    expect(err.kind).toBe("no-text");
    expect(err.message).toMatch(/scan/);
  });

  it("rejects files that are not PDFs and unreadable PDFs", async () => {
    const notPdf = await importPayslipPdf(new TextEncoder().encode("hello world, not a pdf"), "a.txt", nodePdfJs).catch((e) => e);
    expect(notPdf.kind).toBe("not-pdf");
    const broken: PdfJsLib = { getDocument: () => ({ promise: Promise.reject(new Error("Invalid PDF structure")) }) };
    const bad = await importPayslipPdf(new TextEncoder().encode("%PDF-1.7 broken"), "b.pdf", async () => broken).catch((e) => e);
    expect(bad.kind).toBe("unreadable");
  });

  it("text without payslip lines gives 'no-payslip'", async () => {
    const lib: PdfJsLib = {
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [item("Liebe Grüße aus dem Urlaub am Meer, bis bald", 10, 10)] }) }) }),
      }),
    };
    const e = await importPayslipPdf(new TextEncoder().encode("%PDF-1.7 x"), "c.pdf", async () => lib).catch((x) => x);
    expect(e.kind).toBe("no-payslip");
  });
});

describe("no network: the import runs 100 % in the browser", () => {
  const calls: string[] = [];
  const originals = { fetch: globalThis.fetch, XMLHttpRequest: (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest, WebSocket: (globalThis as { WebSocket?: unknown }).WebSocket };
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", (...a: unknown[]) => {
      calls.push(`fetch ${String(a[0])}`);
      return Promise.reject(new Error("network disabled in test"));
    });
    vi.stubGlobal("XMLHttpRequest", function () {
      calls.push("XMLHttpRequest");
      throw new Error("network disabled in test");
    });
    vi.stubGlobal("WebSocket", function () {
      calls.push("WebSocket");
      throw new Error("network disabled in test");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(globalThis.fetch).toBe(originals.fetch);
  });

  it("importing the sample PDF makes no fetch/XHR/WebSocket call", async () => {
    const r = await importPayslipPdf(base64ToBytes(SAMPLE_PAYSLIP_PDF_BASE64), "sample.pdf", nodePdfJs);
    expect(r.parsed.summary.gesamtbrutto?.value).toBe(3501.48);
    expect(calls).toEqual([]);
  });

  it("the app source contains no network APIs or remote URLs (except documentation links in the rules file)", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(new URL("../src", import.meta.url).pathname);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource|navigator\.sendBeacon/);
      if (!f.endsWith("rules/defaults.ts") && !f.endsWith("pages/Sources.tsx")) expect(src, f).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it("the production build forbids network requests via CSP connect-src 'none'", () => {
    const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(cfg).toMatch(/"connect-src 'none'"/);
    expect(cfg).toMatch(/apply: "build"/);
  });
});
