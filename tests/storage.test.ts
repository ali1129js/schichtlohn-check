import { describe, expect, it } from "vitest";
import { DATA_KEY, exportJson, importJson, loadData, memoryKV, saveData } from "@/lib/storage";
import { emptyData, type AppData } from "@/lib/model";
import { shift } from "./helpers";

const sample = (): AppData => ({
  ...emptyData(),
  shifts: [shift("2026-03-04", "22:00", "06:00", [{ start: "02:00", minutes: 30 }], "N")],
  payslips: { "2026-03": { lines: { nacht: { hours: 40, rate: 4.17, amount: 166.8 } }, gesamtbrutto: 3501.48 } },
});

describe("storage", () => {
  it("returns defaults when nothing is stored", () => {
    const r = loadData(memoryKV());
    expect(r.ok).toBe(true);
    expect(r.data.shifts).toEqual([]);
  });

  it("round-trips through save/load", () => {
    const kv = memoryKV();
    const d = sample();
    saveData(kv, d);
    expect(loadData(kv)).toEqual({ ok: true, data: d });
  });

  it.each([
    ["broken JSON", "{nope"],
    ["a newer schema version", JSON.stringify({ ...emptyData(), schemaVersion: 99 })],
    ["bad time", JSON.stringify({ ...emptyData(), shifts: [{ id: "a", date: "2026-03-04", start: "25:00", end: "06:00", breaks: [], kind: "N" }] })],
    ["start equals end", JSON.stringify({ ...emptyData(), shifts: [{ id: "a", date: "2026-03-04", start: "06:00", end: "06:00", breaks: [], kind: "F" }] })],
    ["negative wage", JSON.stringify({ ...emptyData(), settings: { ...emptyData().settings, baseRate: -1 } })],
    ["bad month key", JSON.stringify({ ...emptyData(), payslips: { "2026-13": { lines: {} } } })],
  ])("rejects %s, keeps a backup and leaves the original untouched", (_n, raw) => {
    const kv = memoryKV({ [DATA_KEY]: raw });
    const r = loadData(kv, 42);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.backupKey).toBe(`${DATA_KEY}.backup-42`);
      expect(kv.data[r.backupKey]).toBe(raw);
      expect(r.reason.length).toBeGreaterThan(0);
    }
    expect(kv.data[DATA_KEY]).toBe(raw);
    expect(r.data.shifts).toEqual([]);
  });

  it("refuses to save invalid data", () => {
    const kv = memoryKV();
    const bad = { ...sample(), settings: { ...sample().settings, nightStart: "noon" } };
    expect(() => saveData(kv, bad)).toThrow();
    expect(kv.data[DATA_KEY]).toBeUndefined();
  });

  it("JSON export/import round-trip, also accepts a bare data object", () => {
    const d = sample();
    const text = exportJson(d, new Date("2026-10-27T12:00:00Z"));
    expect(JSON.parse(text)).toMatchObject({ app: "schichtlohn-check", exportedAt: "2026-10-27T12:00:00.000Z" });
    expect(importJson(text)).toEqual({ ok: true, data: d });
    expect(importJson(JSON.stringify(d))).toEqual({ ok: true, data: d });
  });

  it("import rejects garbage with a readable message and never throws", () => {
    expect(importJson("not json")).toEqual({ ok: false, error: "This file is not valid JSON." });
    const r = importJson(JSON.stringify({ app: "schichtlohn-check", data: { version: 1 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/backup/);
  });
});
