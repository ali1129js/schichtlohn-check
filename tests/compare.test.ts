import { describe, expect, it } from "vitest";
import { calcMonth } from "@/lib/calc";
import { comparePayslip } from "@/lib/compare";
import type { Payslip } from "@/lib/model";
import { settings, shift } from "./helpers";

const st = settings({ baseRate: 14.5, bzPct: 15, tolerance: 1 });
const shifts = [
  shift("2026-03-04", "22:00", "06:00", [{ start: "02:00", minutes: 30 }]),
  shift("2026-03-07", "22:00", "06:00", [{ start: "02:00", minutes: 30 }]), // Sat -> Sun
  shift("2026-03-10", "06:00", "14:00", [{ start: "10:00", minutes: 30 }]),
];
const r = calcMonth(shifts, "2026-03", st);
const amt = (k: string) => r.components.find((c) => c.key === k)!;

function matching(): Payslip {
  return {
    lines: {
      grundlohn: { hours: amt("grundlohn").hours, rate: 14.5, amount: amt("grundlohn").amount },
      branchenzuschlag: { amount: amt("branchenzuschlag").amount },
      nacht: { hours: amt("night").hours, rate: amt("night").rate, amount: amt("night").amount },
      sonntag: { amount: amt("sunday").amount },
      fahrgeld: { amount: 9 },
    },
    gesamtbrutto: r.total + 9,
    steuerfrei: r.taxFree + 9,
  };
}

describe("payslip compare", () => {
  it("all lines within tolerance are ok; missing payslip values are marked as such", () => {
    const rows = comparePayslip(r, matching(), st);
    const by = Object.fromEntries(rows.map((x) => [x.key, x]));
    for (const k of ["grundlohn", "branchenzuschlag", "nacht", "sonntag", "gesamtbrutto", "steuerfrei"]) expect(by[k]!.status, k).toBe("ok");
    expect(by.feiertag!.status).toBe("no-payslip");
    expect(by.fahrgeld!.status).toBe("info");
  });

  it("differences above the tolerance are flagged with plain-English hints", () => {
    const p = matching();
    p.lines.nacht = { hours: 10, rate: 4.17, amount: 41.7 };
    const night = comparePayslip(r, p, st).find((x) => x.key === "nacht")!;
    expect(night.status).toBe("diff");
    expect(night.diff).toBeCloseTo(41.7 - amt("night").amount, 2);
    expect(night.hints.join(" ")).toMatch(/payslip counts 10,00 h/);
    expect(night.hints.join(" ")).toMatch(/night work 23:00-06:00/);
  });

  it("small differences up to the tolerance are not flagged", () => {
    const p = matching();
    p.lines.grundlohn = { amount: amt("grundlohn").amount + 0.99 };
    expect(comparePayslip(r, p, st).find((x) => x.key === "grundlohn")!.status).toBe("ok");
    expect(comparePayslip(r, p, { ...st, tolerance: 0.5 }).find((x) => x.key === "grundlohn")!.status).toBe("diff");
  });

  it("lines the app does not calculate are info only, never a difference (arithmetic only as a hint)", () => {
    const p = matching();
    p.lines.tarifurlaub = { hours: 15, rate: 16.7, amount: 260.5 };
    p.lines.fahrgeld = { hours: 210, amount: 31.5 };
    p.lines.freizeit = { hours: 4, rate: 14.5, amount: 58 };
    const rows = comparePayslip(r, p, settings({ ...st, baseRate: 14.5 }));
    for (const k of ["tarifurlaub", "fahrgeld", "freizeit"]) expect(rows.find((x) => x.key === k)!.status).toBe("info");
    expect(rows.find((x) => x.key === "tarifurlaub")!.hints.join(" ")).toMatch(/250,50|250.50/);
    expect(rows.find((x) => x.key === "freizeit")!.hints.join(" ")).toMatch(/base rate/);
  });

  it("other payslip lines are shown as info and count towards the expected Gesamtbrutto", () => {
    const p = matching();
    p.other = [
      { label: "Weihnachtsgeld", category: "oneOff", amount: 100 },
      { label: "Vorschuss", category: "deduction", amount: 50 },
    ];
    p.gesamtbrutto = r.total + 9 + 100;
    const rows = comparePayslip(r, p, st);
    expect(rows.find((x) => x.label === "Weihnachtsgeld")!.status).toBe("info");
    expect(rows.find((x) => x.label === "Vorschuss")).toBeUndefined();
    expect(rows.find((x) => x.key === "gesamtbrutto")!.status).toBe("ok");
  });

  it("Gesamtbrutto expectation includes Tarifurlaub, Freizeitauszahlung and Fahrgeld from the payslip", () => {
    const p = matching();
    p.lines.tarifurlaub = { amount: 100 };
    p.lines.freizeit = { amount: 50 };
    p.gesamtbrutto = r.total + 159;
    expect(comparePayslip(r, p, st).find((x) => x.key === "gesamtbrutto")!.status).toBe("ok");
  });

  it("holiday hint names the workplace state", () => {
    const p = matching();
    p.lines.feiertag = { amount: 99 };
    const row = comparePayslip(r, p, st).find((x) => x.key === "feiertag")!;
    expect(row.status).toBe("diff");
    expect(row.hints.join(" ")).toMatch(/state of the workplace \(set to Berlin\)/);
  });
});
