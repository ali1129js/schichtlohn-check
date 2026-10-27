import { z } from "zod";
import { REGION_IDS } from "./holidays";
import {
  BASE_HOURS_MODE,
  COMBINE_RULE,
  ENTGELTGRUPPEN,
  etvRate,
  HOLIDAY_PCT,
  NIGHT_PCT,
  NIGHT_WINDOW,
  OVERTIME_BASE,
  OVERTIME_PCT,
  OVERTIME_THRESHOLD_PCT,
  SUNDAY_PCT,
  SURCHARGE_BASE,
  WEEKLY_HOURS,
  bzPercentFor,
} from "@/rules/defaults";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "time must be HH:MM");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM");
const pct = z.number().min(0).max(500);
const money = z.number().min(0).max(1000);

export const SettingsSchema = z.object({
  eg: z.union([z.enum(ENTGELTGRUPPEN), z.literal("custom")]),
  baseRate: money,
  bzMonths: z.number().int().min(0).max(240),
  bzAuto: z.boolean(),
  bzPct: pct,
  weeklyHours: z.number().min(1).max(60),
  /** state of the WORKPLACE: decides public holidays */
  region: z.enum(REGION_IDS),
  nightStart: HHMM,
  nightEnd: HHMM,
  nightPct: pct,
  sundayPct: pct,
  holidayPct: pct,
  /** 24.12. and 31.12. from 14:00 paid like a holiday (MTV § 3.6) */
  eveAsHoliday: z.boolean(),
  overtimePct: pct,
  overtimeThresholdPct: pct,
  combine: z.enum(["highest", "sum"]),
  surchargeBase: z.enum(["base", "base+bz"]),
  overtimeBase: z.enum(["base", "base+bz"]),
  baseHoursMode: z.enum(["worked", "contract"]),
  /** payslip compare: differences up to this many EUR are ignored */
  tolerance: z.number().min(0).max(100),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const BreakSchema = z.object({ start: HHMM, minutes: z.number().int().min(0).max(240) });
export type Break = z.infer<typeof BreakSchema>;

export const ShiftSchema = z
  .object({
    id: z.string().min(1),
    /** local date the shift starts on */
    date: DATE,
    start: HHMM,
    /** end <= start means the shift ends on the next day */
    end: HHMM,
    breaks: z.array(BreakSchema).max(4),
    kind: z.enum(["F", "S", "N", "custom"]),
    note: z.string().max(200).optional(),
  })
  .refine((s) => s.start !== s.end, { message: "start and end must differ" });
export type Shift = z.infer<typeof ShiftSchema>;

export const PAYSLIP_LINES = [
  "grundlohn",
  "branchenzuschlag",
  "mehrarbeit",
  "nacht",
  "sonntag",
  "feiertag",
  "tarifurlaub",
  "freizeit",
  "fahrgeld",
] as const;
export type PayslipLine = (typeof PAYSLIP_LINES)[number];

export const PAYSLIP_LINE_LABEL: Record<PayslipLine, string> = {
  grundlohn: "Grundlohn / Normalstunden",
  branchenzuschlag: "Branchenzuschlag",
  mehrarbeit: "Mehrarbeitszuschlag (overtime)",
  nacht: "Nachtzuschlag",
  sonntag: "Sonntagszuschlag",
  feiertag: "Feiertagszuschlag",
  tarifurlaub: "Tarifurlaub / Urlaubsentgelt",
  freizeit: "Freizeitauszahlung (AZK)",
  fahrgeld: "Fahrgeld",
};

const optNum = z.number().min(-100000).max(100000).optional();
export const PayslipLineSchema = z.object({ hours: optNum, rate: optNum, amount: optNum });
export type PayslipLineValue = z.infer<typeof PayslipLineSchema>;

export const PayslipSchema = z.object({
  lines: z.partialRecord(z.enum(PAYSLIP_LINES), PayslipLineSchema),
  gesamtbrutto: optNum,
  steuerfrei: optNum,
  azkSaldo: optNum,
  /** informational values from the payslip that the app does not calculate */
  extra: z.record(z.string(), z.string()).optional(),
});
export type Payslip = z.infer<typeof PayslipSchema>;

export const AppDataSchema = z.object({
  version: z.literal(1),
  settings: SettingsSchema,
  shifts: z.array(ShiftSchema).max(5000),
  payslips: z.record(MONTH, PayslipSchema),
});
export type AppData = z.infer<typeof AppDataSchema>;

export function defaultSettings(today = new Date().toISOString().slice(0, 10)): Settings {
  const eg = "1" as const;
  return {
    eg,
    baseRate: etvRate(eg, today) ?? 15.33,
    bzMonths: 0,
    bzAuto: true,
    bzPct: bzPercentFor(eg, 0),
    weeklyHours: WEEKLY_HOURS.value,
    region: "BE",
    nightStart: NIGHT_WINDOW.value.start,
    nightEnd: NIGHT_WINDOW.value.end,
    nightPct: NIGHT_PCT.value,
    sundayPct: SUNDAY_PCT.value,
    holidayPct: HOLIDAY_PCT.value,
    eveAsHoliday: true,
    overtimePct: OVERTIME_PCT.value,
    overtimeThresholdPct: OVERTIME_THRESHOLD_PCT.value,
    combine: COMBINE_RULE.value,
    surchargeBase: SURCHARGE_BASE.value,
    overtimeBase: OVERTIME_BASE.value,
    baseHoursMode: BASE_HOURS_MODE.value,
    tolerance: 1,
  };
}

export function emptyData(): AppData {
  return { version: 1, settings: defaultSettings(), shifts: [], payslips: {} };
}

export function emptyPayslip(): Payslip {
  return { lines: {} };
}
