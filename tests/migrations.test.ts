import { describe, expect, it } from "vitest";
import { DATA_KEY, importJson, loadData, memoryKV, migrate, MIGRATIONS, saveData } from "@/lib/storage";
import { SCHEMA_VERSION } from "@/lib/model";

// A data snapshot exactly as app version 0.1 (schema 1) saved it: no schemaVersion, no labelMap,
// settings without the fields added later (bzMode, bzHours, surchargeRounding ...).
const V1 = {
  version: 1,
  settings: {
    eg: "2a",
    baseRate: 15.5,
    bzMonths: 10,
    bzAuto: false,
    bzPct: 20,
    region: "BE",
    weeklyHours: 35,
    overtimePct: 25,
    overtimeThresholdPct: 15,
    nightStart: "23:00",
    nightEnd: "06:00",
    nightPct: 25,
    sundayPct: 50,
    holidayPct: 100,
    combine: "highest",
    surchargeBase: "base",
    overtimeBase: "base",
    baseHoursMode: "worked",
    contractStart: "2026-01-01",
    tolerance: 0.05,
  },
  shifts: [{ id: "s1", date: "2026-03-04", start: "22:00", end: "06:00", breaks: [{ start: "02:00", minutes: 30 }], kind: "N" }],
  payslips: { "2026-03": { lines: { nacht: { hours: 7.5, rate: 3.88, amount: 29.1 } }, gesamtbrutto: 100 } },
};

describe("saved data migrations", () => {
  it("has a migration step for every older version", () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("upgrades schema 1 to the current schema without losing shifts, settings or payslips", () => {
    const kv = memoryKV({ [DATA_KEY]: JSON.stringify(V1) });
    const r = loadData(kv);
    expect(r.ok ? "" : r.reason).toBe("");
    expect(r.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.data.shifts).toEqual(V1.shifts);
    expect(r.data.payslips["2026-03"]?.lines.nacht?.amount).toBe(29.1);
    expect(r.data.settings.baseRate).toBe(15.5);
    expect(r.data.settings.combine).toBe("highest");
    expect(r.data.settings.region).toBe("BE");
    // fields added later get their defaults
    expect(r.data.settings.bzMode).toBe("pct");
    expect(r.data.labelMap).toEqual({});
    // the original stays as a copy until the user works with the upgraded data
    expect(kv.data[`${DATA_KEY}.pre-v${SCHEMA_VERSION}`]).toBe(JSON.stringify(V1));
    expect(kv.data[DATA_KEY]).toBe(JSON.stringify(V1));
  });

  it("saves the upgraded data and loads it again unchanged", () => {
    const kv = memoryKV({ [DATA_KEY]: JSON.stringify(V1) });
    const first = loadData(kv).data;
    saveData(kv, { ...first, labelMap: { "gleitzeit +": "azkBooking" } });
    const again = loadData(kv);
    expect(again.ok).toBe(true);
    expect(again.data.labelMap).toEqual({ "gleitzeit +": "azkBooking" });
    expect(again.data.shifts).toEqual(V1.shifts);
  });

  it("keeps label mappings already present", () => {
    const m = migrate({ ...V1, labelMap: { "x zulage": "allowance" } });
    expect(m.ok && (m.data as { labelMap: unknown }).labelMap).toEqual({ "x zulage": "allowance" });
  });

  it("imports an old backup file", () => {
    const r = importJson(JSON.stringify({ app: "schichtlohn-check", exportedAt: "2026-03-31T00:00:00Z", data: V1 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.shifts).toHaveLength(1);
  });

  it("does not touch data saved by a newer app version", () => {
    const raw = JSON.stringify({ ...V1, version: undefined, schemaVersion: SCHEMA_VERSION + 1 });
    const kv = memoryKV({ [DATA_KEY]: raw });
    const r = loadData(kv, 7);
    expect(r.ok).toBe(false);
    expect(kv.data[DATA_KEY]).toBe(raw);
    if (!r.ok) expect(kv.data[r.backupKey]).toBe(raw);
  });
});
