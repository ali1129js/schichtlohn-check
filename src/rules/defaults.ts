/**
 * Default rule values with their sources.
 *
 * verified: true  -> the value was read from an official text (statute on gesetze-im-internet.de,
 *                    or the tariff text published by DGB / a DGB union) on `asOf`.
 * verified: false -> commonly cited or plausible, but NOT confirmed from an official source,
 *                    or it depends on the individual contract / customer company. The UI shows
 *                    an "unconfirmed" badge. Never present these as fact.
 *
 * kind "maximum": the tariff only sets an upper limit; the actual rate follows the customer
 * company's (Kundenbetrieb) surcharge rules, so the value paid may be lower.
 */
export interface RuleValue<T> {
  value: T;
  label: string;
  source: string;
  sourceUrl: string;
  /** ISO date the source was checked */
  asOf: string;
  verified: boolean;
  kind?: "exact" | "maximum";
  note?: string;
}

const CHECKED = "2026-10-27";

export const SRC = {
  estg3b: "https://www.gesetze-im-internet.de/estg/__3b.html",
  svev1: "https://www.gesetze-im-internet.de/svev/__1.html",
  etvGvp: "https://www.dgb.de/fileadmin/download_center/Uploads/2025-09-12_Entgelttarifvertrag_DGB-GVP_ab_01012026.pdf",
  /** IG Metall "Tarifsammlung Leiharbeit 2026/2027": contains MTV DGB/GVP and ETV DGB/GVP */
  mtvGvp: "https://produkte.igmetall.de/media/ba/64/28/1774604019/Tarifsammlung%20Leiharbeit%202026_2027_final.pdf",
  /** TV BZ Chemie (GVP version of 14.11.2024) as published by a staffing agency, not by IG BCE/GVP */
  tvBzChemie: "https://www.dremo.com/fileadmin/Media/PDF/Tarifvertraege/241114_GVP_TV_BZ_Chemie.pdf",
  lsth3b: "https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/2-Steuerfreie-Einnahmen-3-3c/Paragraf-3b/inhalt.html",
} as const;

// ---------------------------------------------------------------- base wage (ETV DGB/GVP)

export const ENTGELTGRUPPEN = ["1", "2a", "2b", "3", "4", "5", "6", "7", "8", "9"] as const;
export type Entgeltgruppe = (typeof ENTGELTGRUPPEN)[number];

/** Hourly table rates (EUR, without Erfahrungszuschlag), ETV DGB/GVP Anlage. */
export const ETV_TABLES: { validFrom: string; validTo: string | null; rates: Record<Entgeltgruppe, number> }[] = [
  {
    validFrom: "2026-01-01",
    validTo: "2026-08-31",
    rates: { "1": 14.96, "2a": 15.29, "2b": 15.69, "3": 16.69, "4": 17.65, "5": 19.78, "6": 21.97, "7": 25.56, "8": 27.36, "9": 28.7 },
  },
  {
    validFrom: "2026-09-01",
    validTo: "2027-03-31",
    rates: { "1": 15.33, "2a": 15.67, "2b": 16.08, "3": 17.11, "4": 18.09, "5": 20.27, "6": 22.52, "7": 26.2, "8": 28.04, "9": 29.42 },
  },
  {
    validFrom: "2027-04-01",
    validTo: null,
    rates: { "1": 15.87, "2a": 16.22, "2b": 16.64, "3": 17.71, "4": 18.72, "5": 20.98, "6": 23.31, "7": 27.12, "8": 29.02, "9": 30.45 },
  },
];

export const ETV_RULE: RuleValue<typeof ETV_TABLES> = {
  value: ETV_TABLES,
  label: "Entgelttabelle DGB/GVP (hourly rates per Entgeltgruppe)",
  source: "Entgelttarifvertrag DGB/GVP of 12.09.2025, Anlage (tables from 01.01.2026 and 01.09.2026); 01.04.2027 table as published by GVP",
  sourceUrl: SRC.etvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Rates from 01.04.2027 were read from personaldienstleister.de (GVP), not from the DGB PDF. Erfahrungszuschlag (+1.5 % after 9 months, +3 % after 12 months at the same customer) is not included; enter it in the hourly rate if it applies.",
};

export function etvRate(eg: Entgeltgruppe, isoDate: string): number | null {
  const t = ETV_TABLES.find((x) => x.validFrom <= isoDate && (x.validTo === null || isoDate <= x.validTo));
  return t ? t.rates[eg] : null;
}

// ---------------------------------------------------------------- Branchenzuschlag (TV BZ Chemie)

export type BzGroup = "EG1-2b" | "EG3-5" | "EG6-9";
export function bzGroup(eg: Entgeltgruppe): BzGroup {
  if (eg === "1" || eg === "2a" || eg === "2b") return "EG1-2b";
  if (eg === "3" || eg === "4" || eg === "5") return "EG3-5";
  return "EG6-9";
}

/** Steps: from `fromMonths` completed months of assignment at the same customer. */
export const BZ_CHEMIE_STEPS: { fromMonths: number; pct: Record<BzGroup, number> }[] = [
  { fromMonths: 0, pct: { "EG1-2b": 15, "EG3-5": 10, "EG6-9": 4 } },
  { fromMonths: 3, pct: { "EG1-2b": 20, "EG3-5": 14, "EG6-9": 6 } },
  { fromMonths: 5, pct: { "EG1-2b": 30, "EG3-5": 21, "EG6-9": 8 } },
  { fromMonths: 7, pct: { "EG1-2b": 45, "EG3-5": 31, "EG6-9": 16 } },
  { fromMonths: 9, pct: { "EG1-2b": 53, "EG3-5": 35, "EG6-9": 20 } },
  { fromMonths: 15, pct: { "EG1-2b": 67, "EG3-5": 45, "EG6-9": 24 } },
];

export const BZ_CHEMIE_RULE: RuleValue<typeof BZ_CHEMIE_STEPS> = {
  value: BZ_CHEMIE_STEPS,
  label: "Branchenzuschlag Chemie (TV BZ Chemie) steps",
  source: "TV BZ Chemie, GVP version of 14.11.2024, § 2 (3) - copy hosted by a staffing agency",
  sourceUrl: SRC.tvBzChemie,
  asOf: CHECKED,
  verified: false,
  kind: "exact",
  note: "Not confirmed from IG BCE or GVP directly. The text still refers to the old ETV BAP/iGZ, which were replaced by ETV DGB/GVP on 01.01.2026. Older versions paid the first step only after 6 weeks. The surcharge can be capped at the pay of a comparable customer employee minus 10 % (§ 2 (5)). Check your payslip / contract.",
};

export function bzPercentFor(eg: Entgeltgruppe, monthsOfAssignment: number): number {
  const g = bzGroup(eg);
  let pct = BZ_CHEMIE_STEPS[0]!.pct[g];
  for (const s of BZ_CHEMIE_STEPS) if (monthsOfAssignment >= s.fromMonths) pct = s.pct[g];
  return pct;
}

// ---------------------------------------------------------------- working time and surcharges (MTV DGB/GVP)

export const WEEKLY_HOURS: RuleValue<number> = {
  value: 35,
  label: "Weekly contractual hours (full time)",
  source: "Manteltarifvertrag DGB/GVP § 3.1: 151.67 h per month = 35 h per week on average",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Your contract may set a different number (MTV § 3.1 allows longer hours in justified cases; former iGZ members may use 140-161 h by working days until 2029).",
};

export const NIGHT_WINDOW: RuleValue<{ start: string; end: string }> = {
  value: { start: "23:00", end: "06:00" },
  label: "Night work window (tariff)",
  source: "MTV DGB/GVP § 6.2: night work is work between 23:00 and 06:00",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "The customer company's rules may use a different window (e.g. 20:00 or 22:00 to 06:00).",
};

export const NIGHT_PCT: RuleValue<number> = {
  value: 25,
  label: "Night surcharge (Nachtzuschlag)",
  source: "MTV DGB/GVP § 6.2: follows the customer company's rules, at most 25 %",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "maximum",
};

export const SUNDAY_PCT: RuleValue<number> = {
  value: 50,
  label: "Sunday surcharge (Sonntagszuschlag)",
  source: "MTV DGB/GVP § 6.3: follows the customer company's rules, at most 50 %",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "maximum",
};

export const HOLIDAY_PCT: RuleValue<number> = {
  value: 100,
  label: "Holiday surcharge (Feiertagszuschlag), also 24.12./31.12. after 14:00",
  source: "MTV DGB/GVP § 6.3 and § 3.6: follows the customer company's rules, at most 100 %",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "maximum",
};

export const OVERTIME_PCT: RuleValue<number> = {
  value: 25,
  label: "Overtime surcharge (Mehrarbeitszuschlag)",
  source: "MTV DGB/GVP § 6.1: 25 % of the tariff hourly wage",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
};

export const OVERTIME_THRESHOLD_PCT: RuleValue<number> = {
  value: 15,
  label: "Overtime starts when monthly hours exceed the contract by more than",
  source: "MTV DGB/GVP § 6.1: only full hours beyond +15 % of the individual monthly hours; taken holiday hours count towards the threshold",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
};

export const COMBINE_RULE: RuleValue<"highest" | "sum"> = {
  value: "highest",
  label: "When night/Sunday/holiday overlap",
  source: "MTV DGB/GVP § 6.4: if several surcharges coincide, only the highest is paid",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Your customer company's rules may add them up instead.",
};

export const SURCHARGE_BASE: RuleValue<"base" | "base+bz"> = {
  value: "base+bz",
  label: "Night/Sunday/holiday surcharges are calculated on",
  source: "MTV DGB/GVP § 6.2/6.3 refer to the hourly wage 'nach §§ 2 bis 4 ETV' (§ 4 ETV = Branchenzuschlag); the sample payslip also uses base + BZ",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: false,
  note: "Our reading of the tariff text, not confirmed. Agencies differ: check which hourly rate your payslip uses for the Nachtzuschlag.",
};

export const OVERTIME_BASE: RuleValue<"base" | "base+bz"> = {
  value: "base+bz",
  label: "Overtime surcharge is calculated on",
  source: "MTV DGB/GVP § 6.1 refers to the hourly wage 'nach §§ 2 bis 4 ETV' (includes § 4 Branchenzuschlag)",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: false,
  note: "Our reading, not confirmed. The sample payslip calculates it on the base wage only (25 % of 14.50 = 3.63).",
};

export const BASE_HOURS_MODE: RuleValue<"worked" | "contract"> = {
  value: "worked",
  label: "Base pay (Grundlohn) is paid for",
  source: "MTV DGB/GVP § 4 (Arbeitszeitkonto): pay is usually for the contractual monthly hours, with extra/missing hours booked to the AZK",
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: false,
  note: "Agencies handle this differently (paying worked hours vs. a fixed monthly amount plus AZK). Check your payslip.",
};

// ---------------------------------------------------------------- § 3b EStG and § 1 SvEV (federal law)

export const S3B = {
  nightPct: 25,
  nightEarlyPct: 40,
  nightStart: "20:00",
  nightEnd: "06:00",
  nightEarlyEnd: "04:00",
  sundayPct: 50,
  holidayPct: 125,
  specialPct: 150,
  maxBaseTax: 50,
  maxBaseSv: 25,
} as const;

export const S3B_RULES: RuleValue<number>[] = [
  { value: 25, label: "§ 3b: night work 20:00-06:00 tax-free up to", source: "§ 3b (1) Nr. 1, (2) Satz 2 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 40, label: "§ 3b: night work 00:00-04:00, if the work started before midnight", source: "§ 3b (3) Nr. 1 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 50, label: "§ 3b: Sunday work (00-24 h; plus 00-04 h of Monday if started before midnight)", source: "§ 3b (1) Nr. 2, (2) Satz 3, (3) Nr. 2 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 125, label: "§ 3b: statutory holidays and 31.12. from 14:00", source: "§ 3b (1) Nr. 3 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 125, label: "§ 3b: Ostersonntag and Pfingstsonntag count as holidays in every state", source: "R 3b (3) Satz 4 LStR (Lohnsteuer-Handbuch 2026)", sourceUrl: SRC.lsth3b, asOf: CHECKED, verified: true, kind: "maximum", note: "Administrative practice of the tax authorities; the BAG (10 AZR 130/19) notes the courts have not finally ruled on it. The tariff holiday surcharge still only applies where the state lists them (Brandenburg)." },
  { value: 150, label: "§ 3b: 24.12. from 14:00, 25.12., 26.12. and 1.5.", source: "§ 3b (1) Nr. 4 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 50, label: "§ 3b: basic hourly wage (Grundlohn) counted at most (EUR)", source: "§ 3b (2) Satz 1 EStG", sourceUrl: SRC.estg3b, asOf: CHECKED, verified: true, kind: "maximum" },
  { value: 25, label: "Social insurance: surcharges stay SV-free only on a wage up to (EUR/h)", source: "§ 1 (1) Satz 1 Nr. 1 SvEV", sourceUrl: SRC.svev1, asOf: CHECKED, verified: true, kind: "maximum" },
];

// ---------------------------------------------------------------- shift presets (not tariff values)

export const SHIFT_PRESETS = {
  F: { label: "Früh", start: "06:00", end: "14:00", breakStart: "10:00", breakMinutes: 30 },
  S: { label: "Spät", start: "14:00", end: "22:00", breakStart: "18:00", breakMinutes: 30 },
  N: { label: "Nacht", start: "22:00", end: "06:00", breakStart: "02:00", breakMinutes: 30 },
} as const;
export type PresetKey = keyof typeof SHIFT_PRESETS;
/** Shift times are only a convenient starting point; they are not tariff values. */
export const SHIFT_PRESETS_NOTE = "Shift times are editable presets, not tariff values. Your plant's real times may differ.";

/** All rules shown on the "Sources" page. */
export const ALL_RULES: RuleValue<unknown>[] = [
  ETV_RULE,
  BZ_CHEMIE_RULE,
  WEEKLY_HOURS,
  NIGHT_WINDOW,
  NIGHT_PCT,
  SUNDAY_PCT,
  HOLIDAY_PCT,
  OVERTIME_PCT,
  OVERTIME_THRESHOLD_PCT,
  COMBINE_RULE,
  SURCHARGE_BASE,
  OVERTIME_BASE,
  BASE_HOURS_MODE,
  ...S3B_RULES,
];
