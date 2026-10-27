import { cents, rates, type Component, type MonthResult } from "./calc";
import { regionLabel } from "./holidays";
import { PAYSLIP_LINE_LABEL, type Payslip, type PayslipLine, type Settings } from "./model";

export type CompareStatus = "ok" | "diff" | "no-payslip" | "info";

export interface CompareRow {
  key: PayslipLine | "gesamtbrutto" | "steuerfrei" | `other:${number}`;
  label: string;
  expected: number | null;
  actual: number | null;
  /** actual - expected */
  diff: number | null;
  status: CompareStatus;
  hints: string[];
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps + 1e-9;
const fmt = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Why a calculated line might differ from the payslip: plain-English, specific where possible. */
function hintsFor(key: Component["key"], c: Component, p: Payslip, r: MonthResult, st: Settings): string[] {
  const line = p.lines[key === "night" ? "nacht" : key === "sunday" ? "sonntag" : key === "holiday" ? "feiertag" : key];
  const h: string[] = [];
  if (line?.hours !== undefined && !near(line.hours, c.hours, 0.01))
    h.push(`The payslip counts ${fmt(line.hours)} h, the app ${fmt(c.hours)} h.`);
  if (line?.rate !== undefined && !near(line.rate, c.rate, 0.005))
    h.push(`The payslip rate is ${fmt(line.rate)} €/h, the app uses ${fmt(c.rate)} €/h.`);
  switch (key) {
    case "grundlohn":
      h.push(
        "Hours: a shift may be missing or entered with a different break; hours of a night shift on the last day of the month count partly in the next month.",
        st.baseHoursMode === "worked"
          ? "Many agencies pay the contractual monthly hours and book extra hours to the Arbeitszeitkonto (AZK). Try 'Base pay for: contractual hours' in Settings."
          : "Some agencies pay the hours actually worked. Try 'Base pay for: worked hours' in Settings.",
        "Rate: check your Entgeltgruppe, the Erfahrungszuschlag (+1.5 % after 9 / +3 % after 12 months) and the tariff increase on 01.09.2026."
      );
      break;
    case "branchenzuschlag":
      h.push(
        "The BZ step depends on completed months at the same customer; a step change mid-month or interruptions over 3 months change it.",
        "The BZ can be capped at the pay of a comparable customer employee minus 10 % (TV BZ Chemie § 2 (5), unconfirmed).",
        st.bzHours === "paid"
          ? "It is paid on all paid hours (base + Urlaub + Freizeitauszahlung hours from the payslip): if those hours differ, the BZ differs too."
          : "It is paid on the base hours: if the base hours differ, the BZ differs too.",
        st.bzMode === "eur" ? "You entered the BZ in €/h: check it against the Satz of the Branchenzuschlag line." : "Tip: you can enter the BZ in €/h exactly as on your payslip (Settings)."
      );
      break;
    case "mehrarbeit":
      h.push(
        `Overtime is only paid for full hours beyond ${fmt(r.overtimeThreshold)} h (contract + ${st.overtimeThresholdPct} %); taken holiday hours count towards this threshold (enter Tarifurlaub hours below).`,
        "Check whether your payslip calculates it on the base wage only or on base + Branchenzuschlag (Settings).",
        "Former iGZ agencies may use a working-day model (160-184 h thresholds) until 2029."
      );
      break;
    case "night":
      h.push(
        `The app counts night work ${st.nightStart}-${st.nightEnd}. The customer company may use another window (e.g. 20:00 or 22:00-06:00).`,
        "The tariff rate is a maximum; the customer company's rule may be lower. Also check base vs base + BZ.",
        st.combine === "highest"
          ? "On Sundays/holidays only the highest surcharge is paid (MTV § 6.4), so night hours there are not counted as night."
          : "Night and Sunday/holiday surcharges are both paid for overlapping hours (likely, from a real payslip). If your payslip pays only one, set 'highest only' in Settings."
      );
      break;
    case "sunday":
      h.push(
        "Sunday is counted 00:00-24:00 local time. A night shift starting Saturday evening is Sunday work only after midnight.",
        st.combine === "highest" ? "A holiday on a Sunday is paid as holiday only." : ""
      );
      break;
    case "holiday":
      h.push(
        `Holidays follow the state of the workplace (set to ${regionLabel(st.region)}), not your home address. E.g. Berlin has Frauentag (8.3.); Brandenburg has Ostersonntag, Pfingstsonntag and Reformationstag.`,
        st.eveAsHoliday ? "24.12. and 31.12. after 14:00 are counted like a holiday (MTV § 3.6)." : "",
        "The customer company's holiday rate may differ (the tariff caps it at 100 %)."
      );
      break;
  }
  return h.filter(Boolean);
}

export function comparePayslip(r: MonthResult, p: Payslip, st: Settings): CompareRow[] {
  const tol = st.tolerance;
  const row = (key: CompareRow["key"], label: string, expected: number | null, actual: number | undefined, hints: () => string[]): CompareRow => {
    if (actual === undefined) return { key, label, expected, actual: null, diff: null, status: "no-payslip", hints: [] };
    if (expected === null) return { key, label, expected, actual, diff: null, status: "info", hints: hints() };
    const diff = cents(actual - expected);
    const bad = Math.abs(diff) > tol + 1e-9;
    return { key, label, expected, actual, diff, status: bad ? "diff" : "ok", hints: bad ? hints() : [] };
  };
  const rows: CompareRow[] = [];
  const map: [Component["key"], PayslipLine][] = [
    ["grundlohn", "grundlohn"],
    ["branchenzuschlag", "branchenzuschlag"],
    ["mehrarbeit", "mehrarbeit"],
    ["night", "nacht"],
    ["sunday", "sonntag"],
    ["holiday", "feiertag"],
  ];
  for (const [ck, pk] of map) {
    const c = r.components.find((x) => x.key === ck)!;
    rows.push(row(pk, PAYSLIP_LINE_LABEL[pk], c.amount, p.lines[pk]?.amount, () => hintsFor(ck, c, p, r, st)));
  }
  // lines the app does not calculate: info only, never reported as a difference
  const infoHints: Record<"tarifurlaub" | "freizeit" | "fahrgeld", (l: NonNullable<Payslip["lines"]["freizeit"]>) => string[]> = {
    tarifurlaub: () => ["Not calculated by the app (taken from the payslip). Its hours count towards the overtime threshold" + (st.bzHours === "paid" ? " and the Branchenzuschlag hours." : ".")],
    freizeit: (l) => {
      const h = ["Not calculated by the app (taken from the payslip)."];
      if (l.rate !== undefined) {
        const base = st.baseRate;
        const withBz = rates(st).withBz;
        if (Math.abs(l.rate - base) < 0.005) h.push("Paid at the base rate; the Branchenzuschlag for these hours belongs in the BZ line.");
        else if (Math.abs(l.rate - withBz) < 0.005) h.push("Paid at base + Branchenzuschlag.");
        else h.push(`The payslip pays ${fmt(l.rate)} €/h; your base rate is ${fmt(base)} €/h.`);
      }
      return h;
    },
    fahrgeld: () => ["Not calculated by the app (taken from the payslip). The quantity is not hours (km, days or a flat amount)."],
  };
  for (const pk of ["tarifurlaub", "freizeit", "fahrgeld"] as const) {
    const l = p.lines[pk];
    const base = row(pk, PAYSLIP_LINE_LABEL[pk], null, l?.amount, () => (l ? infoHints[pk](l) : []));
    if (l?.amount !== undefined && l.hours !== undefined && l.rate !== undefined) {
      const prod = cents(l.hours * l.rate);
      if (Math.abs(prod - l.amount) > tol) base.hints.push(`On the payslip ${fmt(l.hours)} × ${fmt(l.rate)} = ${fmt(prod)}, but the line shows ${fmt(l.amount)}.`);
    }
    rows.push(base);
  }
  const others = (p.other ?? []).filter((o) => o.category !== "deduction" && o.amount !== undefined);
  others.forEach((o, i) =>
    rows.push({
      key: `other:${i}`,
      label: o.label,
      expected: null,
      actual: o.amount ?? null,
      diff: null,
      status: "info",
      hints: [o.category === "other" ? "Not recognised; taken from the payslip as it is." : "Not calculated by the app (taken from the payslip)."],
    })
  );
  const extras =
    (["tarifurlaub", "freizeit", "fahrgeld"] as const).reduce((a, k) => a + (p.lines[k]?.amount ?? 0), 0) + others.reduce((a, o) => a + (o.amount ?? 0), 0);
  rows.push(
    row("gesamtbrutto", "Gesamtbrutto (total gross)", cents(r.total + extras), p.gesamtbrutto, () => [
      "Expected = the app's total plus the info-only lines (Urlaub, Freizeitauszahlung, Fahrgeld and other payslip lines) as taken from the payslip.",
      "Look at the lines above that differ; the payslip may also contain items the app does not know (bonuses, back pay, corrections from earlier months).",
    ])
  );
  const fahrgeld = p.lines.fahrgeld?.amount ?? 0;
  rows.push(
    row("steuerfrei", "davon steuerfrei (§ 3b + tax-free items)", cents(r.taxFree + fahrgeld), p.steuerfrei, () => [
      "Expected = § 3b tax-free surcharges calculated by the app plus Fahrgeld (assumed tax-free, as on the sample payslip).",
      "Only Sunday, holiday and night surcharges within the § 3b limits are tax-free; overtime surcharges never are. The Grundlohn counts at most 50 €/h.",
      "Night work 00:00-04:00 is tax-free up to 40 % only if the work started before midnight.",
    ])
  );
  return rows;
}
