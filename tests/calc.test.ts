import { describe, expect, it } from "vitest";
import { calcMonth, cents, contractMonthHours, monthHours, paidCats, rates, s3bDayPct, shiftInterval, workedMinutes } from "@/lib/calc";
import { settings, shift } from "./helpers";

const H = (min: number) => min / 60;

describe("cents rounding", () => {
  it("rounds half up despite floating point", () => {
    expect(cents(2.175)).toBe(2.18);
    expect(cents(3.625)).toBe(3.63);
    expect(cents(4.17)).toBe(4.17);
    expect(cents(1.005)).toBe(1.01);
  });
});

describe("time splitting", () => {
  const st = settings({ region: "BE" });

  it("day shift with a 30 min break: 7.5 h normal", () => {
    const h = monthHours([shift("2026-03-04", "06:00", "14:00", [{ start: "10:00", minutes: 30 }])], "2026-03", st);
    expect(H(h.worked)).toBe(7.5);
    expect(H(h.normal)).toBe(7.5);
    expect(h.night + h.sunday + h.holiday).toBe(0);
  });

  it("night shift across midnight: night window 23-06, break at 02:00 excluded", () => {
    const h = monthHours([shift("2026-03-04", "22:00", "06:00", [{ start: "02:00", minutes: 30 }])], "2026-03", st);
    expect(H(h.worked)).toBe(7.5);
    expect(H(h.night)).toBe(6.5);
    expect(H(h.normal)).toBe(1);
  });

  it("a night shift on the last day of the month is split between both months", () => {
    const s = [shift("2026-03-31", "22:00", "06:00", [{ start: "02:00", minutes: 30 }])];
    expect(H(monthHours(s, "2026-03", st).worked)).toBe(2);
    expect(H(monthHours(s, "2026-04", st).worked)).toBe(5.5);
  });

  it("year end: 31.12. night shift splits into December and January (Neujahr = holiday)", () => {
    const s = [shift("2026-12-31", "22:00", "06:00")];
    const dec = monthHours(s, "2026-12", st);
    const jan = monthHours(s, "2027-01", st);
    expect(H(dec.worked)).toBe(2);
    expect(H(dec.holiday)).toBe(2); // 31.12. after 14:00 is paid like a holiday (MTV § 3.6)
    expect(H(jan.worked)).toBe(6);
    expect(H(jan.holiday)).toBe(6); // 1.1. is a holiday; highest surcharge wins over night
  });

  it("DST spring forward (29.03.2026): a 22:00-06:00 night shift lasts 7 real hours", () => {
    const s = shift("2026-03-28", "22:00", "06:00");
    const iv = shiftInterval(s);
    expect((iv.endUtc - iv.startUtc) / 3600_000).toBe(7);
    const h = monthHours([s], "2026-03", st);
    expect(H(h.worked)).toBe(7);
    expect(H(h.rawSunday)).toBe(5); // 00:00-06:00 Sunday minus the skipped hour
    expect(H(h.rawNight)).toBe(6); // 23:00-06:00 minus the skipped hour
  });

  it("DST fall back (25.10.2026): a 22:00-06:00 night shift lasts 9 real hours", () => {
    const s = shift("2026-10-24", "22:00", "06:00");
    expect(H(monthHours([s], "2026-10", st).worked)).toBe(9);
    const w = [...workedMinutes(s, st)];
    expect(w.filter((m) => m.minute >= 120 && m.minute < 180)).toHaveLength(120); // 02:00-03:00 twice
  });

  it("an end time inside the repeated autumn hour resolves to its first occurrence (documented)", () => {
    const iv = shiftInterval(shift("2026-10-24", "22:00", "02:30"));
    expect((iv.endUtc - iv.startUtc) / 3600_000).toBe(4.5);
  });

  it("Sunday night shift: Sunday until midnight, then night (highest only, MTV § 6.4)", () => {
    const h = monthHours([shift("2026-03-01", "22:00", "06:00")], "2026-03", st);
    expect(H(h.sunday)).toBe(2);
    expect(H(h.night)).toBe(6);
    expect(H(h.rawNight)).toBe(7);
  });

  it("with combine = sum, night and Sunday are both paid for 23-24 h", () => {
    const h = monthHours([shift("2026-03-01", "22:00", "06:00")], "2026-03", settings({ combine: "sum" }));
    expect(H(h.sunday)).toBe(2);
    expect(H(h.night)).toBe(7);
  });

  it("holiday (Karfreitag 2026) early shift counts as holiday hours", () => {
    const h = monthHours([shift("2026-04-03", "06:00", "14:00")], "2026-04", st);
    expect(H(h.holiday)).toBe(8);
  });

  it("region matters: Pfingstsonntag is a holiday in Brandenburg, only a Sunday in Berlin", () => {
    const s = [shift("2026-05-24", "06:00", "14:00")];
    expect(H(monthHours(s, "2026-05", settings({ region: "BB" })).holiday)).toBe(8);
    const be = monthHours(s, "2026-05", settings({ region: "BE" }));
    expect(H(be.holiday)).toBe(0);
    expect(H(be.sunday)).toBe(8);
  });

  it("customisable night window, e.g. 20:00-06:00", () => {
    const h = monthHours([shift("2026-03-04", "14:00", "22:00")], "2026-03", settings({ nightStart: "20:00" }));
    expect(H(h.night)).toBe(2);
  });

  it("24.12. after 14:00 is paid like a holiday only if enabled", () => {
    const s = [shift("2026-12-24", "12:00", "20:00")];
    expect(H(monthHours(s, "2026-12", st).holiday)).toBe(6);
    expect(H(monthHours(s, "2026-12", settings({ eveAsHoliday: false })).holiday)).toBe(0);
  });
});

describe("surcharge maths", () => {
  it("reproduces the sample payslip rates (14,50 base, 15 % BZ)", () => {
    const r = rates(settings({ baseRate: 14.5, bzPct: 15, holidayPct: 125, overtimeBase: "base" }));
    expect(r.bz).toBe(2.18);
    expect(r.withBz).toBe(16.68);
    expect(r.surcharge.night).toBe(4.17);
    expect(r.surcharge.sunday).toBe(8.34);
    expect(r.surcharge.holiday).toBe(20.85);
    expect(r.overtime).toBe(3.63);
  });

  it("surcharge base 'base' uses the table wage only", () => {
    const r = rates(settings({ baseRate: 14.5, bzPct: 15, surchargeBase: "base", overtimeBase: "base+bz" }));
    expect(r.surcharge.night).toBe(3.63);
    expect(r.overtime).toBe(4.17);
  });

  it("highest-only picks the larger rate and prefers holiday on a tie", () => {
    const st = settings({ nightPct: 25, sundayPct: 50, holidayPct: 100 });
    expect(paidCats({ night: true, sunday: true, holiday: false }, st)).toEqual(["sunday"]);
    expect(paidCats({ night: true, sunday: true, holiday: true }, st)).toEqual(["holiday"]);
    expect(paidCats({ night: true, sunday: false, holiday: false }, settings({ nightPct: 60, sundayPct: 50 }))).toEqual(["night"]);
    expect(paidCats({ night: false, sunday: true, holiday: true }, settings({ sundayPct: 100, holidayPct: 100 }))).toEqual(["holiday"]);
  });

  it("month with one night shift: amounts per component and total", () => {
    const st = settings({ baseRate: 14.5, bzPct: 15 });
    const r = calcMonth([shift("2026-03-04", "22:00", "06:00", [{ start: "02:00", minutes: 30 }])], "2026-03", st);
    const c = Object.fromEntries(r.components.map((x) => [x.key, x]));
    expect(c.grundlohn!.amount).toBe(108.75); // 7.5 h x 14,50
    expect(c.branchenzuschlag!.amount).toBe(16.35); // 7.5 h x 2,18
    expect(c.night!.hours).toBe(6.5);
    expect(c.night!.amount).toBe(27.11); // 6.5 h x 4,17 = 27,105 -> 27,11
    expect(r.total).toBe(cents(108.75 + 16.35 + 27.11));
  });

  it("overtime: only full hours beyond contract + 15 % (35 h/week -> 151,67 h, threshold 174,42 h)", () => {
    expect(contractMonthHours(35)).toBe(151.67);
    // 22 x 8 h + 4 h = 180 h in March 2026 (no breaks)
    const days = Array.from({ length: 22 }, (_, i) => shift(`2026-03-${String(i + 2).padStart(2, "0")}`, "06:00", "14:00"));
    days.push(shift("2026-03-27", "14:00", "18:00"));
    const r = calcMonth(days, "2026-03", settings());
    expect(r.overtimeThreshold).toBe(174.42);
    expect(r.overtimeHours).toBe(5);
    // taken holiday hours count towards the threshold
    expect(calcMonth(days, "2026-03", settings(), 8).overtimeHours).toBe(13);
    // contract mode pays the contractual hours as base and shows the AZK difference
    const c = calcMonth(days, "2026-03", settings({ baseHoursMode: "contract" }));
    expect(c.baseHours).toBe(151.67);
    expect(c.azkDelta).toBe(28.33);
  });
});

describe("§ 3b EStG tax-free limits", () => {
  const amount = (r: ReturnType<typeof calcMonth>, k: string) => r.components.find((c) => c.key === k)!;

  it("night 25 % paid on a 22-06 shift started before midnight is fully tax-free (cap 25 % / 40 %)", () => {
    const r = calcMonth([shift("2026-03-04", "22:00", "06:00")], "2026-03", settings({ baseRate: 14.5, bzPct: 15 }));
    expect(amount(r, "night").taxFree).toBe(amount(r, "night").amount);
  });

  it("40 % applies 00-04 only if the work started before midnight", () => {
    // paid 50 % night 23-06; Grundlohn 20 EUR (no BZ)
    const st = settings({ baseRate: 20, bzPct: 0, nightPct: 50 });
    const before = calcMonth([shift("2026-03-04", "23:00", "06:00")], "2026-03", st);
    // 23-24: 25 % of 20 = 5; 00-04: 40 % = 8/h x 4 = 32; 04-06: 25 % = 5 x 2 = 10 -> 47
    expect(amount(before, "night").taxFree).toBe(47);
    const after = calcMonth([shift("2026-03-05", "00:30", "06:00")], "2026-03", st);
    // 00:30-06:00: 5.5 h x 25 % x 20 = 27.50
    expect(amount(after, "night").taxFree).toBe(27.5);
    expect(amount(after, "night").amount).toBe(55);
  });

  it("Grundlohn is capped at 50 EUR/h for tax and 25 EUR/h for social insurance", () => {
    const st = settings({ baseRate: 60, bzPct: 0, holidayPct: 150 });
    const r = calcMonth([shift("2026-04-03", "06:00", "14:00")], "2026-04", st); // Karfreitag
    const hol = amount(r, "holiday");
    expect(hol.amount).toBe(720); // 8 h x 90
    expect(hol.taxFree).toBe(500); // 8 h x 125 % x 50
    expect(hol.svFree).toBe(250); // 8 h x 125 % x 25
  });

  it("150 % on 25.12., 26.12., 1.5. and 24.12. from 14:00; 125 % on 31.12. from 14:00", () => {
    const st = settings({ baseRate: 20, bzPct: 0, holidayPct: 200 });
    const tf = (d: string, s: string, e: string) => amount(calcMonth([shift(d, s, e)], d.slice(0, 7), st), "holiday").taxFree;
    expect(tf("2026-12-25", "06:00", "14:00")).toBe(240); // 8 x 1.5 x 20
    expect(tf("2026-05-01", "06:00", "14:00")).toBe(240);
    expect(tf("2026-12-24", "14:00", "18:00")).toBe(120); // 4 x 1.5 x 20
    expect(tf("2026-12-31", "14:00", "18:00")).toBe(100); // 4 x 1.25 x 20
    expect(tf("2026-10-03", "06:00", "14:00")).toBe(200); // 8 x 1.25 x 20
  });

  it("Sunday 50 % cap plus night cap; Monday 00-04 still counts as Sunday when started before midnight", () => {
    const st = settings({ baseRate: 20, bzPct: 0, combine: "sum", nightStart: "20:00", sundayPct: 100, nightPct: 50 });
    const r = calcMonth([shift("2026-03-01", "22:00", "06:00")], "2026-03", st);
    // Sunday 22-24 paid 100 % (20/h), night 50 % (10/h). Cap = 50 % + 25 % = 75 % = 15/h -> 30 for 2 h
    // Mon 00-04: Sunday paid? no (Monday). night paid 10/h; cap 40 % + 50 % = 18/h -> 10/h -> 40
    // Mon 04-06: night 10/h; cap 25 % = 5/h -> 10
    expect(cents(r.taxFree)).toBe(80);
  });

  it("overtime surcharges are never tax-free", () => {
    const days = Array.from({ length: 25 }, (_, i) => shift(`2026-03-${String(i + 1).padStart(2, "0")}`, "06:00", "14:00"));
    const r = calcMonth(days, "2026-03", settings());
    expect(amount(r, "mehrarbeit").amount).toBeGreaterThan(0);
    expect(amount(r, "mehrarbeit").taxFree).toBe(0);
  });
});

describe("workplace state decides holidays (BE default)", () => {
  it("defaults to Berlin", () => {
    expect(settings().region).toBe("BE");
  });
  it("work on 8 March 2026 (a Sunday) is holiday work in Berlin but only Sunday work in Brandenburg", () => {
    const s = [shift("2026-03-08", "06:00", "14:00")];
    const be = calcMonth(s, "2026-03", settings({ region: "BE" }));
    const bb = calcMonth(s, "2026-03", settings({ region: "BB" }));
    expect(be.hours.holiday / 60).toBe(8);
    expect(be.hours.sunday).toBe(0);
    expect(bb.hours.holiday).toBe(0);
    expect(bb.hours.sunday / 60).toBe(8);
  });
  it("Reformationstag (31.10.2025, a Friday): holiday in Brandenburg, normal day in Berlin", () => {
    const s = [shift("2025-10-31", "06:00", "14:00")];
    expect(calcMonth(s, "2025-10", settings({ region: "BB" })).hours.holiday / 60).toBe(8);
    expect(calcMonth(s, "2025-10", settings({ region: "BE" })).hours.normal / 60).toBe(8);
  });
});

describe("§ 3b: Oster-/Pfingstsonntag (R 3b (3) Satz 4 LStR)", () => {
  it("count as holidays for the tax-free cap in Berlin, but the tariff pays only the Sunday surcharge there", () => {
    const st = settings({ region: "BE", baseRate: 16, bzPct: 0, holidayPct: 100, sundayPct: 50 });
    const r = calcMonth([shift("2026-04-05", "06:00", "14:00")], "2026-04", st); // Ostersonntag 2026
    expect(r.hours.sunday / 60).toBe(8);
    expect(r.hours.holiday).toBe(0);
    expect(s3bDayPct("2026-04-05", 600, "BE")).toBe(125);
    expect(s3bDayPct("2026-05-24", 600, "NW")).toBe(125); // Pfingstsonntag 2026
    // the full 50 % Sunday surcharge stays below the 125 % cap, so it is completely tax-free
    expect(r.components.find((c) => c.key === "sunday")!.taxFree).toBe(r.components.find((c) => c.key === "sunday")!.amount);
  });
  it("in Brandenburg they are statutory holidays and get the holiday surcharge", () => {
    const r = calcMonth([shift("2026-04-05", "06:00", "14:00")], "2026-04", settings({ region: "BB" }));
    expect(r.hours.holiday / 60).toBe(8);
  });
});
