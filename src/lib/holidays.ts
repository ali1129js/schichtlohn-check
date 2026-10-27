import { z } from "zod";
import holidaysJson from "@/rules/holidays.json";
import { addDays, isoDate, type ISODate } from "./time";

/**
 * The holidays of the WORKPLACE's state apply (§ 3b (2) Satz 4 EStG: "am Ort der Arbeitsstätte";
 * MTV DGB/GVP § 6.3: "Feiertagsrecht des Einsatzortes"), not those of the home address.
 */
export const REGIONS = [
  { id: "BW", label: "Baden-Württemberg" },
  { id: "BY", label: "Bayern" },
  { id: "BE", label: "Berlin" },
  { id: "BB", label: "Brandenburg" },
  { id: "HB", label: "Bremen" },
  { id: "HH", label: "Hamburg" },
  { id: "HE", label: "Hessen" },
  { id: "MV", label: "Mecklenburg-Vorpommern" },
  { id: "NI", label: "Niedersachsen" },
  { id: "NW", label: "Nordrhein-Westfalen" },
  { id: "RP", label: "Rheinland-Pfalz" },
  { id: "SL", label: "Saarland" },
  { id: "SN", label: "Sachsen" },
  { id: "ST", label: "Sachsen-Anhalt" },
  { id: "SH", label: "Schleswig-Holstein" },
  { id: "TH", label: "Thüringen" },
] as const;
export type Region = (typeof REGIONS)[number]["id"];
export const REGION_IDS = REGIONS.map((r) => r.id) as unknown as [Region, ...Region[]];
export const regionLabel = (r: Region) => REGIONS.find((x) => x.id === r)?.label ?? r;

/** Holidays that only apply in parts of a state are NOT included (see README). */
export const HOLIDAY_NOTE =
  "Statewide holidays only. Local ones (Augsburger Friedensfest, Fronleichnam in parts of Sachsen/Thüringen, Mariä Himmelfahrt in Catholic communities of Bayern) are not included.";

const HolidayEntry = z
  .object({
    name: z.string().min(1),
    fixed: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
    easter: z.number().int().min(-60).max(80).optional(),
    special: z.literal("bussUndBettag").optional(),
    regions: z.union([z.literal("all"), z.array(z.enum(REGION_IDS)).min(1)]),
    fromYear: z.number().int().optional(),
    toYear: z.number().int().optional(),
    years: z.array(z.number().int()).optional(),
    note: z.string().optional(),
  })
  .refine((h) => [h.fixed, h.easter, h.special].filter((x) => x !== undefined).length === 1, "needs exactly one of fixed, easter, special");
const HolidaysSchema = z.object({
  schemaVersion: z.literal(1),
  asOf: z.string(),
  source: z.string(),
  verified: z.boolean(),
  note: z.string().optional(),
  holidays: z.array(HolidayEntry).min(1),
});
const parsedHolidays = HolidaysSchema.safeParse(holidaysJson);
if (!parsedHolidays.success) throw new Error(`Invalid rule file src/rules/holidays.json: ${parsedHolidays.error.issues[0]?.path.join(".")}: ${parsedHolidays.error.issues[0]?.message}`);
/** Holiday rules (data file src/rules/holidays.json). */
export const HOLIDAY_DATA = parsedHolidays.data;

/** Easter Sunday (Gregorian), anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): ISODate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(y, month, day);
}

export interface Holiday {
  date: ISODate;
  name: string;
}

/** Buß- und Bettag: the Wednesday before 23 November. */
export function bussUndBettag(y: number): ISODate {
  const nov22 = new Date(Date.UTC(y, 10, 22));
  const back = (nov22.getUTCDay() - 3 + 7) % 7;
  return isoDate(y, 11, 22 - back);
}

/** Statutory statewide public holidays of a German state in year y. */
export function holidays(y: number, region: Region): Holiday[] {
  const e = easterSunday(y);
  const list: Holiday[] = [];
  for (const h of HOLIDAY_DATA.holidays) {
    if (h.regions !== "all" && !h.regions.includes(region)) continue;
    if (h.fromYear !== undefined && y < h.fromYear) continue;
    if (h.toYear !== undefined && y > h.toYear) continue;
    if (h.years && !h.years.includes(y)) continue;
    const date = h.fixed ? isoDate(y, +h.fixed.slice(0, 2), +h.fixed.slice(3)) : h.easter !== undefined ? addDays(e, h.easter) : bussUndBettag(y);
    list.push({ date, name: h.name });
  }
  const seen = new Set<string>();
  return list
    .filter((h) => (seen.has(h.date) ? false : (seen.add(h.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map<string, Map<ISODate, string>>();
export function holidayName(date: ISODate, region: Region): string | null {
  const y = +date.slice(0, 4);
  const key = `${region}${y}`;
  let m = cache.get(key);
  if (!m) {
    m = new Map(holidays(y, region).map((h) => [h.date, h.name]));
    cache.set(key, m);
  }
  return m.get(date) ?? null;
}
