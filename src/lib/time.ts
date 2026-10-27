/**
 * Europe/Berlin wall-clock <-> UTC, implemented from the EU rule (no dependency on the
 * runtime's time-zone database): summer time (CEST, UTC+2) runs from the last Sunday of
 * March 01:00 UTC to the last Sunday of October 01:00 UTC; otherwise CET (UTC+1).
 * tests/time.test.ts cross-checks this against Intl for many dates.
 */

export const MIN = 60_000;

/** "YYYY-MM-DD" */
export type ISODate = string;

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDate(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISODate(s: ISODate): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad date ${s}`);
  return { y: +m[1]!, m: +m[2]!, d: +m[3]! };
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad time ${s}`);
  const h = +m[1]!,
    mi = +m[2]!;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) throw new Error(`bad time ${s}`);
  return h * 60 + mi;
}

export function fmtHHMM(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(d: ISODate): number {
  const { y, m, d: day } = parseISODate(d);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISODate(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Day of month of the last Sunday of a month. */
export function lastSunday(y: number, m: number): number {
  const last = daysInMonth(y, m);
  const wd = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
  return last - wd;
}

/** UTC instants (ms) at which summer time starts and ends in year y. */
export function dstBounds(y: number): { start: number; end: number } {
  return {
    start: Date.UTC(y, 2, lastSunday(y, 3), 1, 0),
    end: Date.UTC(y, 9, lastSunday(y, 10), 1, 0),
  };
}

/** Berlin UTC offset in minutes at a UTC instant. */
export function berlinOffsetAt(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const { start, end } = dstBounds(y);
  return utcMs >= start && utcMs < end ? 120 : 60;
}

export interface WallTime {
  date: ISODate;
  /** minutes since local midnight */
  minute: number;
}

export function utcToBerlin(utcMs: number): WallTime {
  const local = new Date(utcMs + berlinOffsetAt(utcMs) * MIN);
  return {
    date: isoDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/**
 * Berlin wall time -> UTC instant.
 * Non-existent times in the spring gap (02:00-02:59 on the last Sunday of March) are moved
 * forward by one hour (02:30 -> 03:30 CEST), as clocks do. Ambiguous autumn times
 * (02:00-02:59 on the last Sunday of October) resolve to the first occurrence (CEST), unless
 * `preferLater` is set.
 */
export function berlinToUtc(date: ISODate, minute: number, preferLater = false): number {
  const { y, m, d } = parseISODate(date);
  const naive = Date.UTC(y, m - 1, d, 0, minute);
  const asSummer = naive - 120 * MIN;
  const asWinter = naive - 60 * MIN;
  const okSummer = berlinOffsetAt(asSummer) === 120;
  const okWinter = berlinOffsetAt(asWinter) === 60;
  if (okSummer && okWinter) return preferLater ? asWinter : asSummer;
  if (okSummer) return asSummer;
  if (okWinter) return asWinter;
  // spring gap: interpret with the pre-transition offset (CET), which lands one hour later
  return asWinter;
}
