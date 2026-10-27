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
import { z } from "zod";
import tariffsJson from "./tariffs.json";
import s3bJson from "./s3b.json";

export interface RuleValue<T> {
  value: T;
  label: string;
  source: string;
  sourceUrl: string;
  /** ISO date the source was checked */
  asOf: string;
  verified: boolean;
  kind?: "exact" | "maximum";
  /** "likely": seen on a real payslip but not proven (shown with its own badge) */
  status?: "likely";
  note?: string;
}

/** Findings confirmed against a real zvoove payslip. No values from it are stored here. */
export const PAYSLIP_SOURCE = "Confirmed against a real zvoove payslip (zvoove Payroll)";

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

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RuleMeta = {
  label: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string(),
  asOf: IsoDate,
  verified: z.boolean(),
  kind: z.enum(["exact", "maximum"]),
  note: z.string().optional(),
};
const Pct = z.number().min(0).max(200);
const TariffsSchema = z.object({
  schemaVersion: z.literal(1),
  etv: z.object({
    ...RuleMeta,
    tables: z
      .array(z.object({ validFrom: IsoDate, validTo: IsoDate.nullable(), rates: z.record(z.enum(ENTGELTGRUPPEN), z.number().positive().max(200)) }))
      .min(1),
  }),
  bzChemie: z.object({
    ...RuleMeta,
    steps: z.array(z.object({ fromMonths: z.number().int().min(0), pct: z.record(z.enum(["EG1-2b", "EG3-5", "EG6-9"]), Pct) })).min(1),
  }),
});
const S3bSchema = z.object({
  schemaVersion: z.literal(1),
  asOf: IsoDate,
  source: z.string(),
  verified: z.boolean(),
  values: z.object({
    nightPct: Pct,
    nightEarlyPct: Pct,
    nightStart: z.string(),
    nightEnd: z.string(),
    nightEarlyEnd: z.string(),
    sundayPct: Pct,
    holidayPct: Pct,
    specialPct: Pct,
    maxBaseTax: z.number().positive(),
    maxBaseSv: z.number().positive(),
  }),
  rules: z.array(z.object({ ...RuleMeta, value: z.number() }).omit({ asOf: true })).min(1),
});

function load<T>(schema: z.ZodType<T>, data: unknown, name: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`Invalid rule file src/rules/${name}: ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`);
  return r.data;
}
/** Tariff tables (data file src/rules/tariffs.json, see docs/UPDATING-RATES.md). */
export const TARIFFS = load(TariffsSchema, tariffsJson, "tariffs.json");
const S3B_DATA = load(S3bSchema, s3bJson, "s3b.json");

/** Hourly table rates (EUR, without Erfahrungszuschlag), ETV DGB/GVP Anlage. */
export const ETV_TABLES: { validFrom: string; validTo: string | null; rates: Record<Entgeltgruppe, number> }[] = TARIFFS.etv.tables;

const { tables: _t, ...etvMeta } = TARIFFS.etv;
export const ETV_RULE: RuleValue<typeof ETV_TABLES> = { ...etvMeta, value: ETV_TABLES };

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
export const BZ_CHEMIE_STEPS: { fromMonths: number; pct: Record<BzGroup, number> }[] = [...TARIFFS.bzChemie.steps].sort((x, y) => x.fromMonths - y.fromMonths);

const { steps: _s, ...bzMeta } = TARIFFS.bzChemie;
export const BZ_CHEMIE_RULE: RuleValue<typeof BZ_CHEMIE_STEPS> = { ...bzMeta, value: BZ_CHEMIE_STEPS };

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
  value: "sum",
  label: "When night/Sunday/holiday overlap",
  source: `${PAYSLIP_SOURCE}: night and Sunday surcharges are both paid. The MTV DGB/GVP § 6.4 text says only the highest is paid when several coincide`,
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: false,
  status: "likely",
  note: "Likely, not proven: the payslip shows both lines, but the overlapping hours cannot be isolated from it. Your customer company's rule decides; switch to 'highest only' if your payslip pays one surcharge per hour.",
};

export const SURCHARGE_BASE: RuleValue<"base" | "base+bz"> = {
  value: "base+bz",
  label: "Night/Sunday/holiday surcharges are calculated on",
  source: `${PAYSLIP_SOURCE}: the Satz of the Sonntags-/Nachtzuschlag lines is base + Branchenzuschlag. MTV DGB/GVP § 6.2/6.3 refer to the hourly wage 'nach §§ 2 bis 4 ETV' (§ 4 ETV = Branchenzuschlag)`,
  sourceUrl: SRC.mtvGvp,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Confirmed on a real payslip. Other agencies may differ: compare the Satz column of your Nachtzuschlag line.",
};

export const SURCHARGE_ROUNDING: RuleValue<"rate" | "amount"> = {
  value: "amount",
  label: "Surcharge rounding",
  source: `${PAYSLIP_SOURCE}: the Nachtzuschlag amount equals hours × 25 % × Satz rounded once at the end; the printed €/h (Zu/Ab) is rounded for display only`,
  sourceUrl: "",
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Some programs round the €/h first and then multiply; the difference is a few cents.",
};

export const BZ_HOURS: RuleValue<"base" | "paid"> = {
  value: "paid",
  label: "Branchenzuschlag is paid on",
  source: `${PAYSLIP_SOURCE}: the BZ hours equal the Normalstunden plus the Freizeitauszahlung hours (TV BZ Chemie: BZ for every paid hour, incl. Urlaub)`,
  sourceUrl: SRC.tvBzChemie,
  asOf: CHECKED,
  verified: true,
  kind: "exact",
  note: "Confirmed for worked hours and AZK payout hours. Vacation hours could not be checked on that payslip (its Tarifurlaub line shows no hours).",
};

export const AZK_PAYOUT_BASE: RuleValue<"base" | "base+bz"> = {
  value: "base",
  label: "Freizeitauszahlung (AZK payout) is paid at",
  source: `${PAYSLIP_SOURCE}: the Satz of the Freizeitauszahlung line is the base rate; the BZ for those hours is in the Branchenzuschlag line`,
  sourceUrl: "",
  asOf: CHECKED,
  verified: true,
  kind: "exact",
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

export const S3B = S3B_DATA.values;

export const S3B_RULES: RuleValue<number>[] = S3B_DATA.rules.map((r) => ({ ...r, asOf: S3B_DATA.asOf }));

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
