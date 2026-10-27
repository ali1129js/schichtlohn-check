import { describe, expect, it } from "vitest";
import { berlinOffsetAt, berlinToUtc, dstBounds, lastSunday, utcToBerlin, weekday, addDays, daysInMonth, parseHHMM } from "@/lib/time";

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" });
const intlOffset = (ms: number) => {
  const tz = fmt.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")!.value; // "GMT+1"
  return Number(tz.replace("GMT", "")) * 60;
};

describe("Europe/Berlin DST rule", () => {
  it.each([
    [2024, "2024-03-31", "2024-10-27"],
    [2025, "2025-03-30", "2025-10-26"],
    [2026, "2026-03-29", "2026-10-25"],
    [2027, "2027-03-28", "2027-10-31"],
  ])("%i switches on the last Sundays of March and October", (y, mar, oct) => {
    expect(`${y}-03-${lastSunday(y, 3)}`).toBe(mar);
    expect(`${y}-10-${lastSunday(y, 10)}`).toBe(oct);
    const b = dstBounds(y);
    expect(new Date(b.start).toISOString()).toBe(`${mar}T01:00:00.000Z`);
    expect(new Date(b.end).toISOString()).toBe(`${oct}T01:00:00.000Z`);
  });

  it("matches the runtime time-zone database every 3 hours from 2024 to 2030", () => {
    const start = Date.UTC(2024, 0, 1);
    const end = Date.UTC(2031, 0, 1);
    for (let t = start; t < end; t += 3 * 3600_000) expect(berlinOffsetAt(t), new Date(t).toISOString()).toBe(intlOffset(t));
  });

  it("matches Intl exactly around each transition (minute by minute)", () => {
    for (const y of [2025, 2026, 2027]) {
      const b = dstBounds(y);
      for (const edge of [b.start, b.end])
        for (let t = edge - 90 * 60_000; t <= edge + 90 * 60_000; t += 60_000) expect(berlinOffsetAt(t)).toBe(intlOffset(t));
    }
  });

  it("converts wall time to UTC and back", () => {
    expect(new Date(berlinToUtc("2026-01-15", 6 * 60)).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(new Date(berlinToUtc("2026-07-15", 6 * 60)).toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(utcToBerlin(Date.UTC(2026, 6, 14, 22, 30))).toEqual({ date: "2026-07-15", minute: 30 });
  });

  it("moves a non-existent spring time forward and picks the first occurrence of an ambiguous autumn time", () => {
    // 29.03.2026 02:30 does not exist -> 03:30 CEST = 01:30 UTC
    expect(new Date(berlinToUtc("2026-03-29", 150)).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // 25.10.2026 02:30 exists twice: 00:30 UTC (CEST) and 01:30 UTC (CET)
    expect(new Date(berlinToUtc("2026-10-25", 150)).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(new Date(berlinToUtc("2026-10-25", 150, true)).toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("date helpers", () => {
    expect(weekday("2026-03-01")).toBe(0);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(parseHHMM("24:00")).toBe(1440);
    expect(() => parseHHMM("25:00")).toThrow();
  });
});
