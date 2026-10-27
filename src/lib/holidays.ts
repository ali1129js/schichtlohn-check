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

const inR = (r: Region, ...list: Region[]) => list.includes(r);

/** Buß- und Bettag: the Wednesday before 23 November. */
export function bussUndBettag(y: number): ISODate {
  const nov22 = new Date(Date.UTC(y, 10, 22));
  const back = (nov22.getUTCDay() - 3 + 7) % 7;
  return isoDate(y, 11, 22 - back);
}

/** Statutory statewide public holidays of a German state in year y. */
export function holidays(y: number, region: Region): Holiday[] {
  const e = easterSunday(y);
  const r = region;
  const list: Holiday[] = [
    { date: isoDate(y, 1, 1), name: "Neujahr" },
    { date: addDays(e, -2), name: "Karfreitag" },
    { date: addDays(e, 1), name: "Ostermontag" },
    { date: isoDate(y, 5, 1), name: "Tag der Arbeit" },
    { date: addDays(e, 39), name: "Christi Himmelfahrt" },
    { date: addDays(e, 50), name: "Pfingstmontag" },
    { date: isoDate(y, 10, 3), name: "Tag der Deutschen Einheit" },
    { date: isoDate(y, 12, 25), name: "1. Weihnachtstag" },
    { date: isoDate(y, 12, 26), name: "2. Weihnachtstag" },
  ];
  const add = (date: ISODate, name: string) => list.push({ date, name });
  if (inR(r, "BW", "BY", "ST")) add(isoDate(y, 1, 6), "Heilige Drei Könige");
  if ((r === "BE" && y >= 2019) || (r === "MV" && y >= 2023)) add(isoDate(y, 3, 8), "Internationaler Frauentag");
  // Only Brandenburg lists them as statutory holidays (Hessen: "die Sonntage", not separately).
  // For § 3b tax purposes they count everywhere, see s3bDayPct in calc.ts.
  if (r === "BB") {
    add(e, "Ostersonntag");
    add(addDays(e, 49), "Pfingstsonntag");
  }
  if (r === "BE" && (y === 2020 || y === 2025)) add(isoDate(y, 5, 8), "Tag der Befreiung");
  if (inR(r, "BW", "BY", "HE", "NW", "RP", "SL")) add(addDays(e, 60), "Fronleichnam");
  if (r === "SL") add(isoDate(y, 8, 15), "Mariä Himmelfahrt");
  if (r === "TH" && y >= 2019) add(isoDate(y, 9, 20), "Weltkindertag");
  const reformation = inR(r, "BB", "MV", "SN", "ST", "TH") || (inR(r, "HB", "HH", "NI", "SH") && y >= 2018) || y === 2017;
  if (reformation) add(isoDate(y, 10, 31), y === 2017 ? "Reformationstag (500 Jahre)" : "Reformationstag");
  if (inR(r, "BW", "BY", "NW", "RP", "SL")) add(isoDate(y, 11, 1), "Allerheiligen");
  if (r === "SN") add(bussUndBettag(y), "Buß- und Bettag");
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
