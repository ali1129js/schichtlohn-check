import { describe, expect, it } from "vitest";
import { easterSunday, holidayName, holidays } from "@/lib/holidays";

describe("Easter Sunday (Gregorian)", () => {
  it.each([
    [1818, "1818-03-22"],
    [2000, "2000-04-23"],
    [2008, "2008-03-23"],
    [2011, "2011-04-24"],
    [2019, "2019-04-21"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2028, "2028-04-16"],
    [2030, "2030-04-21"],
    [2038, "2038-04-25"],
    [2285, "2285-03-22"],
  ])("%i -> %s", (y, d) => expect(easterSunday(y)).toBe(d));
});

describe("public holidays", () => {
  it("Berlin 2026", () => {
    expect(holidays(2026, "BE")).toEqual([
      { date: "2026-01-01", name: "Neujahr" },
      { date: "2026-03-08", name: "Internationaler Frauentag" },
      { date: "2026-04-03", name: "Karfreitag" },
      { date: "2026-04-06", name: "Ostermontag" },
      { date: "2026-05-01", name: "Tag der Arbeit" },
      { date: "2026-05-14", name: "Christi Himmelfahrt" },
      { date: "2026-05-25", name: "Pfingstmontag" },
      { date: "2026-10-03", name: "Tag der Deutschen Einheit" },
      { date: "2026-12-25", name: "1. Weihnachtstag" },
      { date: "2026-12-26", name: "2. Weihnachtstag" },
    ]);
  });
  it("Brandenburg 2026 has Ostersonntag, Pfingstsonntag and Reformationstag, not Frauentag", () => {
    const bb = holidays(2026, "BB").map((h) => h.date);
    expect(bb).toHaveLength(12);
    expect(bb).toContain("2026-04-05");
    expect(bb).toContain("2026-05-24");
    expect(bb).toContain("2026-10-31");
    expect(bb).not.toContain("2026-03-08");
  });
  it("Berlin one-off Tag der Befreiung only in 2020 and 2025; Frauentag only since 2019", () => {
    expect(holidayName("2025-05-08", "BE")).toBe("Tag der Befreiung");
    expect(holidayName("2020-05-08", "BE")).toBe("Tag der Befreiung");
    expect(holidayName("2026-05-08", "BE")).toBeNull();
    expect(holidayName("2018-03-08", "BE")).toBeNull();
    expect(holidayName("2019-03-08", "BE")).toBe("Internationaler Frauentag");
  });
  it("Easter-based dates in 2027 (early Easter)", () => {
    expect(holidayName("2027-03-26", "BE")).toBe("Karfreitag");
    expect(holidayName("2027-03-29", "BB")).toBe("Ostermontag");
    expect(holidayName("2027-05-06", "BE")).toBe("Christi Himmelfahrt");
    expect(holidayName("2027-05-17", "BB")).toBe("Pfingstmontag");
    expect(holidayName("2027-05-16", "BB")).toBe("Pfingstsonntag");
    expect(holidayName("2027-05-16", "BE")).toBeNull();
  });
  it("Christmas Eve and New Year's Eve are not statutory holidays", () => {
    expect(holidayName("2026-12-24", "BE")).toBeNull();
    expect(holidayName("2026-12-31", "BB")).toBeNull();
  });
});

import { bussUndBettag, REGIONS } from "@/lib/holidays";

describe("all 16 states", () => {
  it("has 16 states, every one with the 9 nationwide holidays", () => {
    expect(REGIONS).toHaveLength(16);
    for (const r of REGIONS) {
      const d = holidays(2026, r.id).map((h) => h.date);
      for (const x of ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"])
        expect(d, `${r.id} ${x}`).toContain(x);
    }
  });
  it.each([
    ["BW", 12], ["BY", 12], ["BE", 10], ["BB", 12], ["HB", 10], ["HH", 10], ["HE", 10], ["MV", 11],
    ["NI", 10], ["NW", 11], ["RP", 11], ["SL", 12], ["SN", 11], ["ST", 11], ["SH", 10], ["TH", 11],
  ] as const)("%s 2026 has %i statewide holidays", (r, n) => expect(holidays(2026, r)).toHaveLength(n));
  it("Buß- und Bettag (Sachsen) is the Wednesday before 23 November", () => {
    expect(bussUndBettag(2026)).toBe("2026-11-18");
    expect(bussUndBettag(2027)).toBe("2027-11-17");
    expect(bussUndBettag(2023)).toBe("2023-11-22");
    expect(holidayName("2026-11-18", "SN")).toBe("Buß- und Bettag");
    expect(holidayName("2026-11-18", "BE")).toBeNull();
  });
  it("Fronleichnam 2026 (4 June) in NW, not in BE; Frauentag in MV since 2023", () => {
    expect(holidayName("2026-06-04", "NW")).toBe("Fronleichnam");
    expect(holidayName("2026-06-04", "BE")).toBeNull();
    expect(holidayName("2023-03-08", "MV")).toBe("Internationaler Frauentag");
    expect(holidayName("2022-03-08", "MV")).toBeNull();
  });
  it("Berlin vs Brandenburg: work location decides (8 March vs Reformationstag)", () => {
    expect(holidayName("2026-03-08", "BE")).toBe("Internationaler Frauentag");
    expect(holidayName("2026-03-08", "BB")).toBeNull();
    expect(holidayName("2026-10-31", "BB")).toBe("Reformationstag");
    expect(holidayName("2026-10-31", "BE")).toBeNull();
  });
});
