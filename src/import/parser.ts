import type { PayslipLine } from "@/lib/model";

/**
 * Rule-based parser for German payslips (Entgeltabrechnung), working on text lines.
 *
 * To support a new layout, usually only LINE_RULES / SUMMARY_RULES need a new pattern:
 *  - LINE_RULES: table rows "Lohnart Bezeichnung ... Std Satz Betrag [St SV]". The first rule
 *    whose `match` hits the description (and no `exclude`) claims the row.
 *  - SUMMARY_RULES: "Label 1.234,56" values found anywhere in the text.
 * Every value carries a confidence (sicher / prüfen / unsicher) and the source line, so the
 * preview can show where it came from. Nothing here does I/O.
 */

export type Confidence = "sicher" | "pruefen" | "unsicher";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { sicher: "sicher", pruefen: "prüfen", unsicher: "unsicher" };

export interface Parsed<T> {
  value: T;
  confidence: Confidence;
  /** the text line the value came from */
  source: string;
  note?: string;
}

export interface ParsedLine {
  hours?: number;
  rate?: number;
  amount?: number;
  /** quantity unit when not hours, e.g. "Tage" */
  unit?: string;
  confidence: Confidence;
  source: string;
  note?: string;
}

export type SummaryField = "gesamtbrutto" | "steuerfrei" | "azkSaldo" | "stundenlohn";

export interface ParsedPayslip {
  /** YYYY-MM */
  month?: Parsed<string>;
  lines: Partial<Record<PayslipLine, ParsedLine>>;
  summary: Partial<Record<SummaryField, Parsed<number>>>;
  /** header facts and net-pay values the app shows but does not calculate */
  info: { label: string; value: string }[];
  /** year-to-date lines (kumuliert): shown separately, never used */
  ytd: string[];
  /** lines with amounts that no rule recognised */
  unmatched: string[];
}

// ------------------------------------------------------------------ numbers

/** German number: 1.234,56 | 1234,56 | 152 | -10,00 | +6,00 */
const NUM = String.raw`[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`;
const NUM_RE = new RegExp(`^${NUM}$`);

export function parseGermanNumber(s: string): number | null {
  const t = s.trim().replace(/\s?(€|EUR|h|Std\.?)$/i, "");
  if (!NUM_RE.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ rules

export interface LineRule {
  field: PayslipLine;
  match: RegExp;
  exclude?: RegExp;
}

/** Order matters: more specific rules first ("Freizeitauszahlung" before anything with "Auszahlung"). */
export const LINE_RULES: LineRule[] = [
  { field: "freizeit", match: /freizeit\s*-?\s*auszahl|azk\s*-?\s*auszahl|auszahlung\s+(?:azk|arbeitszeitkonto|zeitkonto)|stundenauszahlung/i },
  { field: "branchenzuschlag", match: /branchen\s*-?\s*zuschl|\bbz\b|tv\s*bz/i },
  { field: "mehrarbeit", match: /mehrarbeit|über\s*-?\s*stunden|ueberstunden/i },
  { field: "nacht", match: /nacht/i },
  { field: "sonntag", match: /sonntag/i },
  { field: "feiertag", match: /feiertag/i, exclude: /feiertagslohn|feiertagsbezahlung|feiertagsentgelt|bezahlte\s+feiertage/i },
  { field: "tarifurlaub", match: /urlaub/i, exclude: /urlaubsgeld|urlaubsanspruch|rest\s*urlaub/i },
  { field: "fahrgeld", match: /fahrgeld|fahrtkosten|fahrkosten/i },
  { field: "grundlohn", match: /normalstunden|grundlohn|grundvergütung|stundenlohn|lohn\s*\/?\s*std|arbeitsstunden|tarifstunden|gehalt/i },
];

export interface SummaryRule {
  field: SummaryField;
  match: RegExp;
  confidence: Confidence;
}

/** Value regex: label followed by optional ':' and a German number. First rule hit wins per field. */
export const SUMMARY_RULES: SummaryRule[] = [
  { field: "gesamtbrutto", match: new RegExp(String.raw`gesamt\s*-?\s*brutto\s*:?\s*(${NUM})`, "i"), confidence: "sicher" },
  { field: "gesamtbrutto", match: new RegExp(String.raw`^brutto(?:lohn|bezüge)?\s*:?\s*(${NUM})`, "i"), confidence: "pruefen" },
  { field: "steuerfrei", match: new RegExp(String.raw`davon\s+steuerfrei\s*:?\s*(${NUM})`, "i"), confidence: "sicher" },
  { field: "steuerfrei", match: new RegExp(String.raw`steuerfreie?\s+(?:bezüge|zuschläge|anteile?)\s*:?\s*(${NUM})`, "i"), confidence: "pruefen" },
  { field: "azkSaldo", match: new RegExp(String.raw`(?:azk|arbeitszeitkonto|zeitkonto)\b.*?saldo\s*:?\s*(${NUM})`, "i"), confidence: "sicher" },
  { field: "azkSaldo", match: new RegExp(String.raw`^saldo\s+(?:azk|arbeitszeitkonto)\s*:?\s*(${NUM})`, "i"), confidence: "pruefen" },
  { field: "stundenlohn", match: new RegExp(String.raw`stundenlohn\s*:\s*(${NUM})`, "i"), confidence: "sicher" },
];

/** Net-pay and header values: shown for information only (the app does no net/tax maths). */
export const INFO_RULES: { label: string; match: RegExp }[] = [
  { label: "Arbeitnehmer", match: /arbeitnehmer(?:in)?\s*:\s*(.+?)(?:\s{2,}|\s+personal-?nr|$)/i },
  { label: "Einsatzbetrieb", match: /einsatzbetrieb\s*:\s*(.+)$/i },
  { label: "Tarif", match: /tarif(?:vertrag)?\s*:\s*([^\s].*?)(?:\s+entgeltgruppe|$)/i },
  { label: "Entgeltgruppe", match: /entgeltgruppe\s*:?\s*((?:EG\s*)?\d[ab]?)/i },
  { label: "Steuerbrutto", match: new RegExp(String.raw`^steuer\s*-?\s*brutto\s*:?\s*(${NUM})`, "i") },
  { label: "SV-Brutto", match: new RegExp(String.raw`^sv\s*-?\s*brutto\s*:?\s*(${NUM})`, "i") },
  { label: "Lohnsteuer", match: new RegExp(String.raw`^lohnsteuer\s*:?\s*(${NUM})`, "i") },
  { label: "Gesetzliches Netto", match: new RegExp(String.raw`^(?:gesetzliches\s+)?netto(?:lohn|bezüge)?\s*:?\s*(${NUM})`, "i") },
  { label: "Auszahlung", match: new RegExp(String.raw`^(?:auszahlung(?:sbetrag)?|überweisung)\s*:?\s*(${NUM})`, "i") },
];

const YTD = /kumuliert|\bkum\.|jahreswert|jahressumme|lfd\.?\s*jahr|\bytd\b|seit\s+jahresbeginn/i;
const NET_LINE = /^(?:\+\s*)?(lohnsteuer|solidarit|soli\b|kirchensteuer|kist\b|kranken|renten|arbeitslosen|pflege|kv\b|rv\b|av\b|pv\b|steuerbrutto|sv-?brutto|gesetzliches netto|netto|auszahlung|überweisung|steuerfreie bezüge)/i;
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

// ------------------------------------------------------------------ table rows

interface Row {
  code?: string;
  description: string;
  numbers: number[];
  unit?: string;
}

/** Split "1100 Branchenzuschlag Chemie (15%) 152,00 2,18 331,36 L L" into its parts. */
export function splitRow(line: string): Row | null {
  let tokens = line.trim().split(/\s+/);
  let code: string | undefined;
  if (tokens[0] && /^\d{3,5}$/.test(tokens[0]) && tokens.length > 2) code = tokens.shift();
  // trailing tax / social-insurance flags (L/F, J/N, S/P ...)
  while (tokens.length && /^[LFJNSP]$/.test(tokens[tokens.length - 1]!)) tokens.pop();
  const nums: number[] = [];
  let unit: string | undefined;
  while (tokens.length) {
    const t = tokens[tokens.length - 1]!;
    if (/^(tage?|std\.?|h|stk\.?|km|€|eur)$/i.test(t)) {
      if (!/^(€|eur)$/i.test(t)) unit = t.replace(/\.$/, "");
      tokens.pop();
      continue;
    }
    const n = parseGermanNumber(t);
    if (n === null) break;
    nums.unshift(n);
    tokens.pop();
  }
  if (!nums.length || nums.length > 4) return null;
  tokens = tokens.filter(Boolean);
  if (!tokens.length) return null;
  return { code, description: tokens.join(" "), numbers: nums, unit };
}

function rowToLine(row: Row, source: string): ParsedLine {
  const n = row.numbers;
  const unit = row.unit && !/^(std|h)$/i.test(row.unit) ? row.unit : undefined;
  if (n.length >= 3) {
    const [q, rate, amount] = n.slice(-3) as [number, number, number];
    const ok = Math.abs(q * rate - amount) <= Math.max(0.02, Math.abs(amount) * 0.001);
    return {
      hours: unit ? undefined : q,
      rate,
      amount,
      unit,
      confidence: ok ? "sicher" : "pruefen",
      source,
      note: ok ? undefined : `quantity × rate = ${(q * rate).toFixed(2)} does not match the amount`,
    };
  }
  if (n.length === 2) {
    const [q, amount] = n as [number, number];
    return { hours: unit ? undefined : q, amount, unit, confidence: "pruefen", source, note: "no rate column found" };
  }
  return { amount: n[0]!, confidence: "pruefen", source, note: "only an amount found" };
}

function mergeLines(a: ParsedLine, b: ParsedLine): ParsedLine {
  const add = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : Math.round(((x ?? 0) + (y ?? 0)) * 100) / 100);
  return {
    hours: add(a.hours, b.hours),
    amount: add(a.amount, b.amount),
    rate: a.rate === b.rate ? a.rate : undefined,
    unit: a.unit,
    confidence: "pruefen",
    source: `${a.source}\n${b.source}`,
    note: "several payslip lines were added up (e.g. 25 % and 40 % night): check",
  };
}

// ------------------------------------------------------------------ main

function findMonth(lines: string[]): Parsed<string> | undefined {
  for (const l of lines) {
    let m = /abrechnungs(?:monat|zeitraum)\s*:?\s*(\d{1,2})\s*[./]\s*(\d{4})/i.exec(l);
    if (m) return { value: `${m[2]}-${m[1]!.padStart(2, "0")}`, confidence: "sicher", source: l };
    m = new RegExp(`abrechnungs(?:monat|zeitraum)\\s*:?\\s*(${MONTHS.join("|")})\\s+(\\d{4})`, "i").exec(l);
    if (m) return { value: `${m[2]}-${String(MONTHS.indexOf(m[1]!.toLowerCase()) + 1).padStart(2, "0")}`, confidence: "sicher", source: l };
  }
  for (const l of lines) {
    const m = /\b(0[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/.exec(l);
    if (m) return { value: `${m[2]}-${m[1]}`, confidence: "unsicher", source: l, note: "guessed from a date in the text" };
  }
  return undefined;
}

export function parsePayslipLines(rawLines: string[]): ParsedPayslip {
  const lines = rawLines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: ParsedPayslip = { lines: {}, summary: {}, info: [], ytd: [], unmatched: [] };
  out.month = findMonth(lines);

  for (const l of lines) {
    if (YTD.test(l)) {
      out.ytd.push(l);
      continue;
    }
    // summary values may be in their own line or several in one line ("Gesamtbrutto 1; davon steuerfrei 2")
    const parts = l.split(/\s*;\s*/);
    let usedAsSummary = false;
    for (const part of parts) {
      for (const r of SUMMARY_RULES) {
        if (out.summary[r.field]) continue;
        const m = r.match.exec(part);
        if (!m) continue;
        const v = parseGermanNumber(m[1]!);
        if (v === null) continue;
        out.summary[r.field] = { value: v, confidence: r.confidence, source: l };
        usedAsSummary = true;
      }
      for (const r of INFO_RULES) {
        const m = r.match.exec(part);
        if (m && !out.info.some((i) => i.label === r.label)) out.info.push({ label: r.label, value: m[1]!.trim() });
      }
    }
    if (usedAsSummary || NET_LINE.test(l) || /^summen?\b|^gesamt|^davon\b/i.test(l)) continue;
    if (/:\s/.test(l) && !/^\d{3,5}\s/.test(l)) continue; // header "Label: value" lines

    const row = splitRow(l);
    if (!row) continue;
    const rule = LINE_RULES.find((r) => r.match.test(row.description) && !r.exclude?.test(row.description));
    if (!rule) {
      out.unmatched.push(l);
      continue;
    }
    const parsed = rowToLine(row, l);
    if (!row.code && parsed.confidence === "sicher") parsed.confidence = "pruefen";
    const prev = out.lines[rule.field];
    out.lines[rule.field] = prev ? mergeLines(prev, parsed) : parsed;
  }

  // a header "Stundenlohn: 14,50" confirms the base rate
  const sl = out.summary.stundenlohn;
  const g = out.lines.grundlohn;
  if (sl && g && g.rate !== undefined && Math.abs(g.rate - sl.value) > 0.005) {
    g.confidence = "unsicher";
    g.note = `the header says Stundenlohn ${sl.value.toFixed(2)}, the row says ${g.rate.toFixed(2)}`;
  }
  if (!out.month) out.month = undefined;
  return out;
}

/** Fields found, for "did we recognise a payslip at all?" */
export function foundCount(p: ParsedPayslip): number {
  return Object.keys(p.lines).length + Object.keys(p.summary).length;
}
