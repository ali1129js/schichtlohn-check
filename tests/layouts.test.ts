import { describe, expect, it } from "vitest";
import { textLinesFromItems } from "@/import/pdfText";
import { parsePayslipLines } from "@/import/parser";
import { detectProfile, PROFILES } from "@/import/profiles";
import { CATEGORIES } from "@/import/categories";
import { PROFILE_DATA } from "@/parser";
import { ProfileSchema } from "@/parser/schema";
import { datevItems, zvooveItems } from "./fixtures/synthetic";

const zv = () => parsePayslipLines(textLinesFromItems(zvooveItems()));

describe("layout profiles are data", () => {
  it("loads every profile file and validates it", () => {
    expect(PROFILE_DATA.map((p) => p.id).sort()).toEqual(["datev", "landwehr", "lexware-lohn-gehalt", "lohn-gehaltsabrechnung-mmyyyy", "zvoove"]);
    for (const p of PROFILE_DATA) expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(PROFILES.find((p) => p.id === "zvoove")?.checked).toBe(true);
  });
  it("rejects a broken profile", () => {
    expect(ProfileSchema.safeParse({ schemaVersion: 1, id: "x", name: "x", checked: false, verified: false, asOf: "2026-10-27", source: "s", markers: [{ pattern: "(", weight: 5 }] }).success).toBe(false);
  });
  it("every category in the dictionary is known", () => {
    expect(Object.keys(CATEGORIES)).toContain("other");
  });
});

describe("synthetic zvoove payslip", () => {
  it("detects the profile, the column table and the month", () => {
    const p = zv();
    expect(p.profile.id).toBe("zvoove");
    expect(p.table).toBe("columns");
    expect(p.month?.value).toBe("2026-10");
  });
  it("reads Satz and Zu/Ab: the surcharge rate is Zu/Ab, Satz is its base", () => {
    const p = zv();
    expect(p.lines.nacht).toMatchObject({ hours: 40, rate: 4.62, amount: 184.9, baseRate: 18.49 });
    expect(p.lines.sonntag).toMatchObject({ hours: 8, rate: 9.25, amount: 73.96 });
    expect(p.lines.grundlohn).toMatchObject({ hours: 150, rate: 16.08, amount: 2412 });
    expect(p.lines.branchenzuschlag).toMatchObject({ hours: 158, rate: 2.41, amount: 380.78 });
    expect(p.lines.freizeit).toMatchObject({ hours: 8, rate: 16.08, amount: 128.64 });
  });
  it("Urlaub amount only, Fahrgeld never as hours", () => {
    const p = zv();
    expect(p.lines.tarifurlaub?.amount).toBe(307.2);
    expect(p.lines.tarifurlaub?.hours).toBeUndefined();
    expect(p.lines.fahrgeld?.amount).toBe(45);
    expect(p.lines.fahrgeld?.hours).toBeUndefined();
  });
  it("lists unknown lines as other and keeps the AZK booking", () => {
    const p = zv();
    const other = p.other.map((r) => [r.label, r.category]);
    expect(other).toContainEqual(["Musterprojekt Ausgleich", "other"]);
    expect(p.rows.find((r) => r.label.startsWith("Gleitzeit"))?.category).toBe("azkBooking");
  });
  it("reads label/value total blocks and cross-checks the row sums", () => {
    const p = zv();
    expect(p.summary.gesamtbrutto?.value).toBe(3582.48);
    expect(p.summary.steuerbrutto?.value).toBe(3278.62);
    expect(p.summary.svbrutto?.value).toBe(3278.62);
    expect(p.summary.auszahlung?.value).toBe(2301.15);
    expect(p.summary.azkSaldo?.value).toBe(24.5);
    const gross = p.checks.find((c) => c.id === "gross");
    expect(gross?.ok).toBe(true);
  });
  it("never uses year-to-date values", () => {
    const p = zv();
    expect(p.ytd.length).toBeGreaterThanOrEqual(2);
    expect(p.summary.gesamtbrutto?.value).not.toBe(31234.56);
    expect(p.rows.some((r) => r.amount === 1660)).toBe(false);
  });
  it("uses the user's label mapping", () => {
    const p = parsePayslipLines(textLinesFromItems(zvooveItems()), { labelMap: { "musterprojekt ausgleich": "allowance" } });
    const row = p.other.find((r) => r.label === "Musterprojekt Ausgleich");
    expect(row).toMatchObject({ category: "allowance", by: "user" });
  });
});

describe("synthetic DATEV payslip (basic generic coverage)", () => {
  const p = () => parsePayslipLines(textLinesFromItems(datevItems()));
  it("detects DATEV, flagged as not checked", () => {
    expect(detectProfile("DATEV LODAS").profile.id).toBe("datev");
    expect(p().profile).toMatchObject({ id: "datev", checked: false });
    expect(p().month?.value).toBe("2026-09");
  });
  it("uses the profile's own wage-type names and totals", () => {
    const r = p();
    expect(r.lines.grundlohn).toMatchObject({ hours: 160, rate: 16.08, amount: 2572.8 });
    expect(r.lines.nacht).toMatchObject({ hours: 20, rate: 4.02, amount: 80.4 });
    expect(r.summary.gesamtbrutto?.value).toBe(2665.2);
    expect(r.other.map((o) => o.label)).toContain("Werkzeuggeld");
  });
});
