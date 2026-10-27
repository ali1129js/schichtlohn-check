import { S3B } from "@/rules/defaults";
import { easterSunday, holidayName, type Region } from "./holidays";
import type { Settings, Shift } from "./model";
import { addDays, berlinToUtc, MIN, parseHHMM, utcToBerlin, weekday, type ISODate } from "./time";

/** Round to cents, half up, robust against binary floating point (2.175 -> 2.18). */
export function cents(x: number): number {
  return Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7)) / 100;
}

export interface ShiftInterval {
  startUtc: number;
  endUtc: number;
  /** break intervals as UTC instants, clipped to the shift */
  breaks: [number, number][];
}

/** Resolve a shift to UTC instants. End <= start means the next day; DST is respected. */
export function shiftInterval(s: Pick<Shift, "date" | "start" | "end" | "breaks">): ShiftInterval {
  const sm = parseHHMM(s.start);
  const em = parseHHMM(s.end);
  const startUtc = berlinToUtc(s.date, sm);
  const endDate = em <= sm ? addDays(s.date, 1) : s.date;
  // An end time inside the repeated autumn hour (02:00-02:59 on the last Sunday of October)
  // is ambiguous; we take its first occurrence (CEST). Shifts ending at 06:00 are unaffected.
  const endUtc = berlinToUtc(endDate, em);
  const breaks: [number, number][] = [];
  for (const b of s.breaks) {
    if (b.minutes <= 0) continue;
    const bm = parseHHMM(b.start);
    const bDate = bm < sm ? addDays(s.date, 1) : s.date;
    let bs = berlinToUtc(bDate, bm);
    if (bs < startUtc) bs = berlinToUtc(bDate, bm, true);
    const be = bs + b.minutes * MIN;
    const cs = Math.max(bs, startUtc),
      ce = Math.min(be, endUtc);
    if (ce > cs) breaks.push([cs, ce]);
  }
  return { startUtc, endUtc, breaks };
}

/** Classification of one worked minute. */
export interface MinuteInfo {
  date: ISODate;
  minute: number;
  /** tariff categories */
  night: boolean;
  sunday: boolean;
  holiday: boolean;
  /** § 3b EStG tax-free cap in percent of the Grundlohn for this minute */
  s3bPct: number;
}

function inWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export interface ClassifyOptions {
  region: Region;
  nightStart: string;
  nightEnd: string;
  eveAsHoliday: boolean;
}

/** Per-day § 3b rate (Sunday/holiday part only, not night). */
export function s3bDayPct(date: ISODate, minute: number, region: Region): number {
  const md = date.slice(5);
  if (md === "12-25" || md === "12-26" || md === "05-01") return S3B.specialPct;
  if (md === "12-24" && minute >= 14 * 60) return S3B.specialPct;
  if (holidayName(date, region)) return S3B.holidayPct;
  // R 3b (3) Satz 4 LStR: Oster- and Pfingstsonntag count as holidays for § 3b in every state,
  // even where the state law does not list them (only Brandenburg does).
  const easter = easterSunday(+date.slice(0, 4));
  if (date === easter || date === addDays(easter, 49)) return S3B.holidayPct;
  if (md === "12-31" && minute >= 14 * 60) return S3B.holidayPct;
  if (weekday(date) === 0) return S3B.sundayPct;
  return 0;
}

/** Iterate the worked minutes of a shift (breaks excluded) with their classification. */
export function* workedMinutes(s: Shift, o: ClassifyOptions): Generator<MinuteInfo> {
  const iv = shiftInterval(s);
  const ns = parseHHMM(o.nightStart),
    ne = parseHHMM(o.nightEnd);
  const s3bNs = parseHHMM(S3B.nightStart),
    s3bNe = parseHHMM(S3B.nightEnd),
    s3bEarly = parseHHMM(S3B.nightEarlyEnd);
  const startDate = utcToBerlin(iv.startUtc).date;
  for (let t = iv.startUtc; t < iv.endUtc; t += MIN) {
    if (iv.breaks.some(([a, b]) => t >= a && t < b)) continue;
    const { date, minute } = utcToBerlin(t);
    const md = date.slice(5);
    const isHoliday = holidayName(date, o.region) !== null;
    const eve = o.eveAsHoliday && (md === "12-24" || md === "12-31") && minute >= 14 * 60;
    // § 3b: work "begun before midnight" = this minute lies on a later date than the shift start
    const startedBefore = date > startDate;
    let night3b = 0;
    if (inWindow(minute, s3bNs, s3bNe)) night3b = startedBefore && minute < s3bEarly ? S3B.nightEarlyPct : S3B.nightPct;
    let day3b = s3bDayPct(date, minute, o.region);
    if (startedBefore && minute < s3bEarly) day3b = Math.max(day3b, s3bDayPct(addDays(date, -1), 24 * 60 - 1, o.region));
    yield {
      date,
      minute,
      night: inWindow(minute, ns, ne),
      sunday: weekday(date) === 0,
      holiday: isHoliday || eve,
      s3bPct: night3b + day3b,
    };
  }
}

export interface MonthHours {
  /** minutes worked in the month (breaks excluded) */
  worked: number;
  /** minutes without any night/Sunday/holiday surcharge */
  normal: number;
  /** minutes per surcharge category that is PAID (after the combine rule) */
  night: number;
  sunday: number;
  holiday: number;
  /** minutes falling in each category regardless of the combine rule (for information) */
  rawNight: number;
  rawSunday: number;
  rawHoliday: number;
  /** tax-free (§ 3b EStG) and SV-free (§ 1 SvEV) EUR per category, computed minute by minute */
  taxFree: Record<SurchargeCat, number>;
  svFree: Record<SurchargeCat, number>;
}

export type SurchargeCat = "night" | "sunday" | "holiday";

/** Which surcharges are paid for a minute under the combine rule. */
export function paidCats(m: Pick<MinuteInfo, "night" | "sunday" | "holiday">, st: Settings): SurchargeCat[] {
  const cats: { c: SurchargeCat; p: number }[] = [];
  if (m.holiday) cats.push({ c: "holiday", p: st.holidayPct });
  if (m.sunday) cats.push({ c: "sunday", p: st.sundayPct });
  if (m.night) cats.push({ c: "night", p: st.nightPct });
  if (cats.length === 0) return [];
  if (st.combine === "sum") return cats.map((x) => x.c);
  // highest only; on a tie the earlier entry (holiday > Sunday > night) wins
  let best = cats[0]!;
  for (const x of cats) if (x.p > best.p) best = x;
  return [best.c];
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

/** Aggregate all minutes of `shifts` whose local date lies in `month` (YYYY-MM). */
export function monthHours(shifts: Shift[], month: string, st: Settings): MonthHours {
  const r: MonthHours = {
    worked: 0,
    normal: 0,
    night: 0,
    sunday: 0,
    holiday: 0,
    rawNight: 0,
    rawSunday: 0,
    rawHoliday: 0,
    taxFree: { night: 0, sunday: 0, holiday: 0 },
    svFree: { night: 0, sunday: 0, holiday: 0 },
  };
  const rt = rates(st);
  const prev = monthKey(addDays(`${month}-01`, -1));
  for (const s of shifts) {
    const mk = monthKey(s.date);
    if (mk !== month && mk !== prev) continue;
    for (const m of workedMinutes(s, st)) {
      if (monthKey(m.date) !== month) continue;
      r.worked++;
      if (m.night) r.rawNight++;
      if (m.sunday) r.rawSunday++;
      if (m.holiday) r.rawHoliday++;
      const cats = paidCats(m, st);
      if (cats.length === 0) r.normal++;
      for (const c of cats) r[c]++;
      // § 3b: per minute, the paid surcharge is tax-free up to cap% of the Grundlohn
      // (at most 50 EUR/h; for social insurance at most 25 EUR/h). The cap is shared by the
      // paid categories in proportion to what they pay.
      if (cats.length && m.s3bPct > 0) {
        const paid = cats.map((c) => rt.surcharge[c] / 60);
        const total = paid.reduce((a, b) => a + b, 0);
        if (total > 0) {
          const capT = (m.s3bPct / 100) * rt.capTax / 60;
          const capS = (m.s3bPct / 100) * rt.capSv / 60;
          cats.forEach((c, i) => {
            r.taxFree[c] += (Math.min(total, capT) * paid[i]!) / total;
            r.svFree[c] += (Math.min(total, capS) * paid[i]!) / total;
          });
        }
      }
    }
  }
  return r;
}

export interface Rates {
  bz: number;
  withBz: number;
  /** EUR per hour per surcharge category, rounded to cents like a payslip line */
  surcharge: Record<SurchargeCat, number>;
  /** the same without rounding (used when only the amount is rounded) */
  surchargeExact: Record<SurchargeCat, number>;
  /** effective BZ percentage (also when the BZ is entered in EUR per hour) */
  bzPct: number;
  overtime: number;
  /** § 3b Grundlohn per hour (base + Branchenzuschlag) and its caps */
  grundlohn: number;
  capTax: number;
  capSv: number;
}

export function rates(st: Settings): Rates {
  const bz = st.bzMode === "eur" ? cents(st.bzEur) : cents((st.baseRate * st.bzPct) / 100);
  const withBz = cents(st.baseRate + bz);
  const surBase = st.surchargeBase === "base+bz" ? withBz : st.baseRate;
  const otBase = st.overtimeBase === "base+bz" ? withBz : st.baseRate;
  return {
    bz,
    withBz,
    bzPct: st.bzMode === "eur" ? (st.baseRate > 0 ? Math.round((bz / st.baseRate) * 10000) / 100 : 0) : st.bzPct,
    surchargeExact: {
      night: (surBase * st.nightPct) / 100,
      sunday: (surBase * st.sundayPct) / 100,
      holiday: (surBase * st.holidayPct) / 100,
    },
    surcharge: {
      night: cents((surBase * st.nightPct) / 100),
      sunday: cents((surBase * st.sundayPct) / 100),
      holiday: cents((surBase * st.holidayPct) / 100),
    },
    overtime: cents((otBase * st.overtimePct) / 100),
    grundlohn: withBz,
    capTax: Math.min(withBz, S3B.maxBaseTax),
    capSv: Math.min(withBz, S3B.maxBaseSv),
  };
}

export interface Component {
  key: "grundlohn" | "branchenzuschlag" | "mehrarbeit" | SurchargeCat;
  label: string;
  hours: number;
  rate: number;
  amount: number;
  /** tax-free under § 3b (EUR) */
  taxFree: number;
  /** social-insurance-free (EUR), § 1 SvEV: Grundlohn counted up to 25 EUR/h */
  svFree: number;
}

export interface MonthResult {
  month: string;
  hours: MonthHours;
  contractHours: number;
  overtimeThreshold: number;
  overtimeHours: number;
  /** worked minus contractual hours (positive = plus hours towards the AZK) */
  azkDelta: number;
  baseHours: number;
  bzRate: number;
  grundlohnPerHour: number;
  components: Component[];
  total: number;
  taxFree: number;
  svFree: number;
}

export function contractMonthHours(weeklyHours: number): number {
  return Math.round(((weeklyHours * 13) / 3) * 100) / 100;
}

const h2 = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const h2r = (hours: number) => Math.round(hours * 100) / 100;

/**
 * Gross pay for one month. `vacationHours` (Tarifurlaub hours from the payslip) count towards
 * the overtime threshold (MTV § 6.1) but are not paid by this calculation. With
 * bzHours = "paid", the Branchenzuschlag is also due on those hours and on the AZK payout
 * hours (`payoutHours`), as on a real zvoove payslip.
 */
export function calcMonth(shifts: Shift[], month: string, st: Settings, vacationHours = 0, payoutHours = 0): MonthResult {
  const hours = monthHours(shifts, month, st);
  const worked = hours.worked / 60;
  const contractHours = contractMonthHours(st.weeklyHours);
  const overtimeThreshold = Math.round(contractHours * (1 + st.overtimeThresholdPct / 100) * 100) / 100;
  // only FULL hours beyond the threshold count (MTV § 6.1)
  const overtimeHours = Math.max(0, Math.floor(worked + vacationHours - overtimeThreshold + 1e-9));
  const baseHours = st.baseHoursMode === "contract" ? contractHours : h2(hours.worked);
  const rt = rates(st);
  const bzHours = h2r(baseHours + (st.bzHours === "paid" ? vacationHours + payoutHours : 0));
  const line = (key: Component["key"], label: string, hrs: number, rate: number, taxFree = 0, svFree = 0, exact?: number): Component => {
    const amount = cents(hrs * (st.surchargeRounding === "amount" && exact !== undefined ? exact : rate));
    return { key, label, hours: hrs, rate, amount, taxFree: cents(Math.min(amount, taxFree)), svFree: cents(Math.min(amount, svFree)) };
  };
  const components: Component[] = [
    line("grundlohn", "Grundlohn (base)", baseHours, st.baseRate),
    line("branchenzuschlag", `Branchenzuschlag ${rt.bzPct} %`, bzHours, rt.bz),
    line("night", `Nachtzuschlag ${st.nightPct} %`, h2(hours.night), rt.surcharge.night, hours.taxFree.night, hours.svFree.night, rt.surchargeExact.night),
    line("sunday", `Sonntagszuschlag ${st.sundayPct} %`, h2(hours.sunday), rt.surcharge.sunday, hours.taxFree.sunday, hours.svFree.sunday, rt.surchargeExact.sunday),
    line("holiday", `Feiertagszuschlag ${st.holidayPct} %`, h2(hours.holiday), rt.surcharge.holiday, hours.taxFree.holiday, hours.svFree.holiday, rt.surchargeExact.holiday),
    line("mehrarbeit", `Mehrarbeitszuschlag ${st.overtimePct} %`, overtimeHours, rt.overtime),
  ];
  const sum = (f: (c: Component) => number) => cents(components.reduce((a, c) => a + f(c), 0));
  return {
    month,
    hours,
    contractHours,
    overtimeThreshold,
    overtimeHours,
    azkDelta: Math.round((worked - contractHours) * 100) / 100,
    baseHours,
    bzRate: rt.bz,
    grundlohnPerHour: rt.grundlohn,
    components,
    total: sum((c) => c.amount),
    taxFree: sum((c) => c.taxFree),
    svFree: sum((c) => c.svFree),
  };
}
