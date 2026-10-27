import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/App";
import { DATA_KEY, memoryKV } from "@/lib/storage";
import type { AppData } from "@/lib/model";
import { DataProvider } from "@/state/DataContext";
import { ThemeProvider } from "@/state/ThemeContext";
import { settings, shift } from "./helpers";

// Server-side render smoke test of every page (no DOM needed): catches render errors and checks
// that the required notices are on screen.
const data: AppData = {
  schemaVersion: 2,
  labelMap: {},
  settings: settings({ region: "BE" }),
  shifts: [shift("2026-03-07", "22:00", "06:00", [{ start: "02:00", minutes: 30 }]), shift("2026-03-08", "06:00", "14:00")],
  payslips: { "2026-03": { lines: { nacht: { hours: 7.5, rate: 3.84, amount: 28.8 } }, gesamtbrutto: 100 } },
};

function render(hash: string, stored: string | null = JSON.stringify(data)) {
  const kv = memoryKV(stored === null ? {} : { [DATA_KEY]: stored });
  Object.assign(globalThis, { localStorage: { ...kv, removeItem: (k: string) => delete kv.data[k] }, location: { hash } });
  return renderToStaticMarkup(
    <ThemeProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </ThemeProvider>
  );
}

describe("UI smoke (server render)", () => {
  const g = globalThis as Record<string, unknown>;
  let saved: unknown[];
  beforeEach(() => (saved = [g.localStorage, g.location]));
  afterEach(() => ([g.localStorage, g.location] = saved));

  it.each(["#shifts", "#pay", "#payslip", "#settings", "#data"])("%s renders with the privacy note and gross-only footer", (hash) => {
    const html = render(hash);
    expect(html).toContain("Your data never leaves this device.");
    expect(html).toContain("Gross pay only");
  });
  it("pay page says gross only", () => expect(render("#pay")).toMatch(/Gross only\.<\/strong>/));
  it("payslip page states browser-only PDF processing and offers the sample", () => {
    const html = render("#payslip");
    expect(html).toContain("Processed 100 % in your browser.");
    expect(html).toContain("Try sample");
  });
  it("settings: 16-state selector defaulting to Berlin, work-location note, nationwide tariff note", () => {
    const html = render("#settings", null);
    expect(html.match(/<select id="region">([\s\S]*?)<\/select>/)?.[1]?.match(/<option/g)).toHaveLength(16);
    expect(html).toMatch(/<option value="BE" selected="">Berlin<\/option>/);
    expect(html).toContain("Work location decides holidays");
    expect(html).toContain("Tariff rates are nationwide.");
    expect(html).toContain("Ost/West difference is gone");
    expect(html).toContain("unconfirmed");
  });
  it("shows the corruption alert and keeps a backup when stored data is broken", () => {
    expect(render("#shifts", "{broken")).toContain("Saved data could not be read");
  });
});
