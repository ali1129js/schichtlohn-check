import type { PayslipLine } from "@/lib/model";
import { CATEGORIES, categorize as categorizeBase, type CategoryId, type LabelMap } from "./categories";
import { toTextLines, type TextLine, type Token } from "./pdfText";
import { detectProfile, GENERIC, type Profile, type ProfileId } from "./profiles";

/**
 * Universal parser for German payslips (Entgeltabrechnung / Verdienstabrechnung).
 *
 * 1. The wage-type table is found by its column headers (NR | Lohnartbezeichnung | Stunden |
 *    Satz | Zu/Ab | ... | Brutto, or Lohnart | Bezeichnung | Menge | Faktor | Betrag ...). Numbers
 *    are mapped to columns by their position. Without a header, the numbers at the end of a row
 *    are used (last number = amount).
 * 2. Row labels are categorised with a synonym dictionary (categories.ts) plus the user's own
 *    label mapping. Rows that are not recognised are never dropped: they are returned as
 *    "other" with their raw label and amount.
 * 3. Totals are read from "Label value" pairs and from label rows with the values on the next
 *    line (zvoove style). Year-to-date blocks (Jahressummen, kumuliert) are kept apart.
 * 4. The rows are added up and checked against the gross total.
 * Every value carries a confidence (sicher / prüfen / unsicher) and its source line. No I/O.
 */

export type Confidence = "sicher" | "pruefen" | "unsicher";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { sicher: "sicher", pruefen: "prüfen", unsicher: "unsicher" };

export interface Parsed<T> {
  value: T;
  confidence: Confidence;
  /** the text line the value came from */
  source: string;
  note?: string;
  /** read from the PDF text layer or by OCR (set by the import, see ocr/reliability.ts) */
  origin?: "text" | "ocr";
  /** OCR word confidence 0-100 */
  ocrConfidence?: number;
}

export interface ParsedLine {
  hours?: number;
  /** per hour/unit; for surcharges with a Zu/Ab column this is the surcharge per hour */
  rate?: number;
  /** the hourly rate the surcharge was calculated on (Satz column next to Zu/Ab) */
  baseRate?: number;
  amount?: number;
  /** quantity unit when not hours, e.g. "Tage" */
  unit?: string;
  confidence: Confidence;
  source: string;
  origin?: "text" | "ocr";
  ocrConfidence?: number;
  note?: string;
}

export interface ParsedRow extends ParsedLine {
  code?: string;
  label: string;
  category: CategoryId;
  /** how the category was chosen */
  by: "user" | "dictionary" | "none";
  /** quantity when it is not hours (km, days, units) */
  quantity?: number;
  /** taxable / social-insurance part when the payslip has such columns */
  taxable?: number;
  svable?: number;
  taxFree?: boolean;
}

export type SummaryField = "gesamtbrutto" | "steuerbrutto" | "svbrutto" | "steuerfrei" | "netto" | "auszahlung" | "azkSaldo" | "gesStunden" | "stundenlohn";

export const SUMMARY_LABEL: Record<SummaryField, string> = {
  gesamtbrutto: "Gesamtbrutto",
  steuerbrutto: "Steuerbrutto",
  svbrutto: "SV-Brutto",
  steuerfrei: "davon steuerfrei",
  netto: "Netto",
  auszahlung: "Auszahlung",
  azkSaldo: "AZK / Gleitzeit balance",
  gesStunden: "Total hours",
  stundenlohn: "Stundenlohn",
};

export interface CrossCheck {
  id: "gross" | "taxable" | "svable" | "taxfree";
  label: string;
  /** sum of the table rows */
  rows: number;
  /** the payslip's own total */
  total: number;
  ok: boolean;
}

export interface ParsedPayslip {
  profile: { id: ProfileId; name: string; checked: boolean; note: string };
  /** how the wage-type table was read */
  table: "columns" | "heuristic" | "none";
  /** YYYY-MM */
  month?: Parsed<string>;
  lines: Partial<Record<PayslipLine, ParsedLine>>;
  /** every wage-type row of the month, in payslip order */
  rows: ParsedRow[];
  /** rows the app does not calculate (info only) and rows that were not recognised */
  other: ParsedRow[];
  summary: Partial<Record<SummaryField, Parsed<number>>>;
  /** header facts and net-pay values the app shows but does not calculate */
  info: { label: string; value: string }[];
  /** year-to-date lines (Jahressummen, kumuliert): shown separately, never used */
  ytd: string[];
  /** source lines of rows that no dictionary entry recognised */
  unmatched: string[];
  /** rows added up vs. the payslip totals */
  checks: CrossCheck[];
}

export interface ParseOptions {
  /** user mapping label -> category (remembered in the browser) */
  labelMap?: LabelMap;
  /** PDF producer/creator metadata, for profile detection */
  producer?: string;
}

// the profile detected for the payslip being parsed (parsing is synchronous)
let active: Profile = GENERIC;
const categorize = (label: string, map: LabelMap) => categorizeBase(label, map, active.synonyms);

// ------------------------------------------------------------------ numbers

/** German number: 1.234,56 | 1234,56 | 152 | -10,00 | +6,00 | 10,00- */
const NUM = String.raw`[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`;
const NUM_RE = new RegExp(`^${NUM}$`);

export function parseGermanNumber(s: string): number | null {
  let t = s.trim().replace(/\s?(€|EUR|h|Std\.?)$/i, "");
  let neg = false;
  if (/^\d.*-$/.test(t)) {
    // trailing minus, as some programs print deductions
    neg = true;
    t = t.slice(0, -1);
  }
  if (!NUM_RE.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const tokNum = (s: string) => parseGermanNumber(s.replace(/[;|]+$/, ""));
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.001);
const UNIT_RE = /^(tage?|std\.?|h|stk\.?|km|€|eur|%)$/i;
const FLAG_RE = /^[A-Z]{1,2}$/;

// ------------------------------------------------------------------ labels

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

interface TotalRule {
  field: SummaryField;
  re: RegExp;
  confidence: Confidence;
}

/** Anchored, tested on a lower-cased label candidate (trailing ':' / '.' removed). */
const TOTAL_RULES: TotalRule[] = [
  {
    field: "gesamtbrutto",
    re: /^(?:gesamt\s*-?\s*brutto|summe\s*-?\s*brutto|summebrutto|brutto\s*-?\s*summe|gesamt\s*-?\s*bezüge|brutto\s+gesamt|summe\s+(?:der\s+)?bezüge|brutto\s*-?\s*bezüge|brutto\s*-?\s*verdienst|gesamt\s*-?\s*brutto\s*-?\s*lohn)$/,
    confidence: "sicher",
  },
  { field: "gesamtbrutto", re: /^(?:brutto|bruttolohn|brutto\s*-?\s*entgelt|summen?\s+brutto)$/, confidence: "pruefen" },
  {
    field: "steuerbrutto",
    re: /^(?:steuer\s*-?\s*brutto|steuerpfl(?:ichtiges)?\.?(?:\s*brutto)?|st\s*-?\s*brutto|lst\s*-?\s*brutto|stpfl\.?\s*brutto|steuerpflichtig)$/,
    confidence: "sicher",
  },
  {
    field: "svbrutto",
    re: /^(?:sv\s*-?\s*brutto|kv\s*-?\s*brutto|kv\s*-?\s*verspfl\.?|kvverspfl\.?|sv\s*-?\s*pflichtiges\s+brutto|sozialversicherungs\s*-?\s*brutto|svpfl\.?\s*brutto)$/,
    confidence: "sicher",
  },
  {
    field: "steuerfrei",
    re: /^(?:davon\s+steuerfrei|steuerfrei|steuerfreie?\s+(?:bezüge|zuschläge|anteile?|beträge|zahlungen)|stfrei|st\s*-?\s*frei)$/,
    confidence: "sicher",
  },
  { field: "netto", re: /^(?:gesetzliches\s+netto|netto|nettolohn|netto\s*-?\s*bezüge|nettoverdienst|netto\s*-?\s*entgelt|netto\s*-?\s*betrag)$/, confidence: "sicher" },
  {
    field: "auszahlung",
    re: /^(?:auszahlung|auszahlungsbetrag|auszahlbetrag|überweisung|überweisungsbetrag|zahlbetrag|auszuzahlender\s+betrag)$/,
    confidence: "sicher",
  },
  { field: "azkSaldo", re: /^(?:azk\s*-?\s*saldo|saldo\s+(?:azk|arbeitszeitkonto|zeitkonto|gleitzeit)|gleitzeit\s*-?\s*saldo|arbeitszeitkonto|zeitkonto\s*-?\s*saldo)$/, confidence: "sicher" },
  { field: "azkSaldo", re: /^(?:gleitzeit|zeitkonto|stundenkonto|azk)$/, confidence: "pruefen" },
  { field: "gesStunden", re: /^(?:ges\.?\s*stunden|gesamt\s*-?\s*stunden|stunden\s+gesamt|summe\s+stunden)$/, confidence: "sicher" },
  { field: "stundenlohn", re: /^(?:stundenlohn|stundensatz|grundlohn\s*\/\s*std)$/, confidence: "sicher" },
];

/** net-side values that are shown for information only */
const INFO_LABEL =
  /^(?:lohnst|lohnsteuer|kirch|kist|soli|solidarit|kranken|kv\b|kv-|renten|rentvers|rv\b|rv-|arbeitslos|arblos|av\b|pflege|pv\b|kammer|umlage|sachbez|jahr-?\s*ausgl|lst-?\s*jahres|vwl|vorschuss|pfändung|abzüge|end-?\s*summe|summe\s+abzüge|netto|nettobe|gesetzliche|sozialvers)/i;

/** header facts in "Label: value" form */
const HEADER_FACTS: { label: string; match: RegExp }[] = [
  { label: "Arbeitnehmer", match: /arbeitnehmer(?:in)?\s*:\s*(.+?)(?:\s{2,}|\s+personal-?nr|$)/i },
  { label: "Einsatzbetrieb", match: /einsatzbetrieb\s*:\s*(.+)$/i },
  { label: "Tarif", match: /tarif(?:vertrag)?\s*:\s*([^\s].*?)(?:\s+entgeltgruppe|$)/i },
  { label: "Entgeltgruppe", match: /entgeltgruppe\s*:?\s*((?:EG\s*)?\d[ab]?)\b/i },
];

const YTD_WORD = /kumuliert|\bkum\.|jahreswert|jahressumme|jahres\s*-\s*summ|lfd\.?\s*jahr|\bytd\b|seit\s+jahresbeginn|bis\s+lfd|aufgelaufen/i;
const isYtdHead = (s: string) => YTD_HEAD.test(s) || active.ytdHeadings.some((re) => re.test(s));
const YTD_HEAD = /^(?:jahres\s*-?\s*summen|jahreswerte|jahresübersicht|jahres\s*-?\s*kumul|kumulierte\s+werte|summen\s+(?:lfd\.?\s*|laufendes\s+)?jahr|werte\s+seit\s+jahresbeginn)/i;
const TABLE_END = /^(?:(?:monats)?summen?\b|gesamt\s*-?\s*brutto|st\s*\/\s*sv\b|abzüge\b|gesetzliche|netto|lohnsteuer\b|steuerbrutto|sv-?brutto|auszahlung\b|überweisung|steuer\s*\/\s*sozial|be-?\s*\/\s*abz)/i;

function cleanLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^[+\-=*]\s*/, "")
    .replace(/(?:\s*\d\))+$/, "")
    .replace(/\s*(?:€|eur)$/i, "")
    .replace(/\s*[:]$/, "")
    .trim();
}
const norm = (s: string) => cleanLabel(s).toLowerCase().replace(/[.:]+$/, "").replace(/\s+/g, " ").trim();

/** Candidates from the end of a label: "Summen: Gesamtbrutto" -> "Summen: Gesamtbrutto", "Gesamtbrutto". */
function candidates(label: string): string[] {
  const words = cleanLabel(label).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let k = Math.min(4, words.length); k >= 1; k--) out.push(words.slice(-k).join(" ").replace(/^.*:\s*/, (m) => (k === words.length ? m : "")));
  // the part after the last colon
  const afterColon = cleanLabel(label).split(/:\s*/).pop();
  if (afterColon) out.push(afterColon);
  return [...new Set(out.map(cleanLabel).filter(Boolean))];
}

function matchTotal(label: string, lineText: string): { rule: TotalRule; text: string } | undefined {
  for (const c of candidates(label)) {
    const n = norm(c);
    const own = Object.entries(active.totals).find(([, res]) => res?.some((re) => re.test(n)));
    if (own) return { rule: { field: own[0] as SummaryField, re: /./, confidence: "sicher" }, text: c };
    const rule = TOTAL_RULES.find((r) => r.re.test(n));
    if (rule) return { rule, text: c };
    if (n === "saldo" && /azk|arbeitszeitkonto|zeitkonto|gleitzeit/i.test(lineText))
      return { rule: { field: "azkSaldo", re: /saldo/, confidence: "sicher" }, text: c };
  }
  return undefined;
}

const isInfoLabel = (label: string) => INFO_LABEL.test(cleanLabel(label));
const isKnownLabel = (label: string, line: string) => !!matchTotal(label, line) || isInfoLabel(label);

// ------------------------------------------------------------------ token groups

const GAP = 8;

function groupTokens(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  for (const t of tokens) {
    const g = out[out.length - 1];
    const prev = g?.[g.length - 1];
    if (g && prev && t.x - (prev.x + prev.w) <= GAP) g.push(t);
    else out.push([t]);
  }
  return out;
}
const joinTokens = (ts: Token[]) => ts.map((t) => t.s).join(" ");

interface Pair {
  label: string;
  raw: string;
  value: number;
  x: number;
}

/** "Label value" pairs on a line, plus numbers without a label in front (values of a label row above). */
function linePairs(l: TextLine): { pairs: Pair[]; loose: Token[] } {
  const pairs: Pair[] = [];
  const loose: Token[] = [];
  let buf: Token[] = [];
  let lastWasNumber = false;
  for (const t of l.tokens) {
    if (/^[|;]$/.test(t.s)) {
      buf = [];
      lastWasNumber = false;
      continue;
    }
    const n = tokNum(t.s);
    if (n !== null) {
      const groups = groupTokens(buf);
      const label = groups.length ? joinTokens(groups[groups.length - 1]!) : "";
      if (label && /[a-zäöüß]/i.test(label)) pairs.push({ label: cleanLabel(label), raw: t.s.replace(/[;|]+$/, ""), value: n, x: t.x });
      else loose.push(t);
      buf = [];
      lastWasNumber = true;
    } else if (lastWasNumber && UNIT_RE.test(t.s)) {
      // unit after a number ("28,50 h")
    } else {
      buf.push(t);
      lastWasNumber = false;
    }
    if (/[;|]$/.test(t.s)) buf = [];
  }
  return { pairs, loose };
}

/** A row of labels with the values on the next line (zvoove: "Ges. Stunden  Gleitzeit  KrankenVers."). */
function labelRow(l: TextLine): { label: string; x: number }[] | null {
  if (l.tokens.some((t) => tokNum(t.s) !== null)) return null;
  const groups = groupTokens(l.tokens).map((g) => ({ label: cleanLabel(joinTokens(g)), x: g[0]!.x }));
  if (groups.length < 2) return null;
  if (!groups.some((g) => isKnownLabel(g.label, l.text))) return null;
  return groups;
}

// ------------------------------------------------------------------ table header

type ColKind = "code" | "label" | "cost" | "days" | "qty" | "rate" | "zuab" | "flag" | "taxable" | "svable" | "amount";

const HEADER_WORDS: [ColKind, RegExp][] = [
  ["code", /^(?:nr\.?|lohnart-?nr\.?|la|lart|la-?nr\.?|schl\.?|schlüssel|nummer|lohnart|lohnarten?-?nr\.?)$/i],
  ["label", /^(?:lohnartbezeichnung|lohnarten-?bezeichnung|lohnart-?bezeichnung|bezeichnung|lohnartentext|text|beschreibung|bezüge)$/i],
  ["cost", /^(?:kst\.?|kostenstelle|kostenst\.?)$/i],
  ["days", /^tage$/i],
  ["qty", /^(?:stunden|std\.?|menge|anzahl|std\.?\/tage|stk\.?|einheiten|menge\/std\.?)$/i],
  ["rate", /^(?:satz|faktor|lohnsatz|stundensatz|preis|einzelbetrag|€\/std\.?|€\/h)$/i],
  ["zuab", /^(?:zu\/ab|zu-?\/abschlag|zuschlag)$/i],
  ["flag", /^(?:st|sv|gb|kz|lst|st\/sv|sv\/st)$/i],
  ["taxable", /^(?:stpfl\.?|steuerpfl\.?|st-?pfl\.?)$/i],
  ["svable", /^(?:sozpfl\.?|svpfl\.?|sv-?pfl\.?)$/i],
  ["amount", /^(?:brutto|betrag|gesamt|summe|gesamtbetrag|bruttobetrag)$/i],
];

interface Column {
  kind: ColKind;
  name: string;
  x: number;
  right: number;
}

interface Header {
  cols: Column[];
  labelEnd: number;
  labelX: number;
  codeCol?: Column;
}

function detectHeader(l: TextLine): Header | null {
  if (l.tokens.length < 3 || l.tokens.length > 20) return null;
  const cols: Column[] = [];
  let unknown = 0;
  for (const t of l.tokens) {
    const s = t.s.replace(/[:]$/, "");
    if (/^(?:€|eur)$/i.test(s) && cols.length) {
      cols[cols.length - 1]!.right = t.x + t.w;
      continue;
    }
    const own = Object.entries(active.headers).find(([, words]) => words?.some((w) => w.toLowerCase() === s.toLowerCase()));
    const k: [ColKind, RegExp] | undefined = own ? [own[0] as ColKind, /./] : HEADER_WORDS.find(([, re]) => re.test(s));
    if (!k) {
      unknown++;
      continue;
    }
    cols.push({ kind: k[0], name: s, x: t.x, right: t.x + t.w });
  }
  // "Lohnart" is the code column if there is a separate description column, else it is the label
  const hasLabel = cols.some((c) => c.kind === "label");
  for (const c of cols) if (!hasLabel && c.kind === "code" && /^lohnart$/i.test(c.name)) c.kind = "label";
  const kinds = new Set(cols.map((c) => c.kind));
  if (!kinds.has("amount") || !(kinds.has("label") || kinds.has("code"))) return null;
  if (cols.length < 3 || unknown > Math.max(1, cols.length / 3)) return null;
  if (!kinds.has("qty") && !kinds.has("rate") && !kinds.has("days")) return null;
  // several "amount"-like headers: only the right-most is the amount
  const amounts = cols.filter((c) => c.kind === "amount");
  for (const c of amounts.slice(0, -1)) c.kind = "rate";
  const sorted = [...cols].sort((a, b) => a.x - b.x);
  const label = sorted.find((c) => c.kind === "label");
  const afterLabel = label ? sorted.find((c) => c.x > label.x && c.kind !== "label") : sorted.find((c) => c.kind !== "code");
  return { cols: sorted, labelEnd: (afterLabel?.x ?? Infinity) - 2, labelX: label?.x ?? 0, codeCol: sorted.find((c) => c.kind === "code") };
}

interface RawRow {
  code?: string;
  label: string;
  values: Partial<Record<ColKind, number>>;
  flags: { col?: string; v: string }[];
  unit?: string;
  extra: number[];
  mode: "columns" | "heuristic";
  ambiguous: boolean;
}

function parseColumnRow(l: TextLine, h: Header): RawRow | null {
  const numeric = h.cols.filter((c) => !["code", "label", "flag"].includes(c.kind));
  const flagCols = h.cols.filter((c) => c.kind === "flag");
  const labelToks: string[] = [];
  let code: string | undefined;
  const values: Partial<Record<ColKind, number>> = {};
  const dist: Partial<Record<ColKind, number>> = {};
  const flags: RawRow["flags"] = [];
  const extra: number[] = [];
  let unit: string | undefined;
  let ambiguous = false;
  l.tokens.forEach((t, i) => {
    const centre = t.x + t.w / 2;
    if (centre < h.labelEnd) {
      if (i === 0 && /^\d{2,6}$/.test(t.s) && (h.codeCol ? t.x < h.labelX - 1 : l.tokens.length > 2)) code = t.s;
      else labelToks.push(t.s);
      return;
    }
    const n = tokNum(t.s);
    if (n !== null) {
      const ranked = numeric
        .map((c) => ({ c, d: Math.min(Math.abs(t.x + t.w - c.right), Math.abs(t.x - c.x), Math.abs(centre - (c.x + c.right) / 2)) }))
        .sort((a, b) => a.d - b.d);
      const place = ranked.find((r) => r.d <= 45 && (values[r.c.kind] === undefined || r.d < (dist[r.c.kind] ?? Infinity)));
      if (!place) {
        extra.push(n);
        ambiguous = true;
        return;
      }
      const k = place.c.kind;
      if (values[k] !== undefined) {
        extra.push(values[k]!);
        ambiguous = true;
      }
      values[k] = n;
      dist[k] = place.d;
      return;
    }
    if (FLAG_RE.test(t.s) && flagCols.length) {
      const fc = [...flagCols].sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
      flags.push({ col: fc?.name.toUpperCase(), v: t.s });
      return;
    }
    if (UNIT_RE.test(t.s)) {
      if (!/^(?:€|eur|%)$/i.test(t.s)) unit = t.s.replace(/\.$/, "");
      return;
    }
    labelToks.push(t.s);
  });
  if (!Object.keys(values).length) return null;
  const label = cleanLabel(labelToks.join(" "));
  if (!/[a-zäöüß]{2}/i.test(label)) return null;
  return { code, label, values, flags, unit, extra, mode: "columns", ambiguous };
}

// ------------------------------------------------------------------ rows without a header

interface Row {
  code?: string;
  description: string;
  numbers: number[];
  unit?: string;
}

/** Split "1100 Branchenzuschlag Chemie (15%) 152,00 2,18 331,36 L L" into its parts. */
export function splitRow(line: string): Row | null {
  const r = splitRowLoose(line);
  if (!r || r.numbers.length > 4) return null;
  return { code: r.code, description: r.description, numbers: r.numbers, unit: r.unit };
}

function splitRowLoose(line: string): (Row & { flags: string[] }) | null {
  let tokens = line.trim().split(/\s+/);
  let code: string | undefined;
  if (tokens[0] && /^\d{3,5}$/.test(tokens[0]) && tokens.length > 2) code = tokens.shift();
  const nums: number[] = [];
  const flags: string[] = [];
  let unit: string | undefined;
  while (tokens.length) {
    const t = tokens[tokens.length - 1]!;
    if (/^[LFJNSP]$/.test(t)) {
      flags.unshift(t);
      tokens.pop();
      continue;
    }
    if (/^(tage?|std\.?|h|stk\.?|km|€|eur)$/i.test(t)) {
      if (!/^(€|eur)$/i.test(t)) unit = t.replace(/\.$/, "");
      tokens.pop();
      continue;
    }
    const n = tokNum(t);
    if (n === null) break;
    nums.unshift(n);
    tokens.pop();
  }
  if (!nums.length || nums.length > 8) return null;
  tokens = tokens.filter(Boolean);
  if (!tokens.length) return null;
  return { code, description: tokens.join(" "), numbers: nums, unit, flags };
}

function heuristicRow(line: string): RawRow | null {
  const r = splitRowLoose(line);
  if (!r) return null;
  const n = r.numbers;
  const values: RawRow["values"] = {};
  let ambiguous = false;
  values.amount = n[n.length - 1];
  if (n.length >= 3) {
    // find quantity x rate = amount among the numbers before the amount
    let found = false;
    for (let i = 0; i < n.length - 1 && !found; i++)
      for (let j = i + 1; j < n.length - 1 && !found; j++)
        if (n[i] !== 0 && n[j] !== 0 && near(n[i]! * n[j]!, values.amount!)) {
          values.qty = n[i];
          values.rate = n[j];
          found = true;
        }
    if (!found) {
      values.qty = n[n.length - 3];
      values.rate = n[n.length - 2];
      ambiguous = n.length > 3;
    }
  } else if (n.length === 2) values.qty = n[0];
  return {
    code: r.code,
    label: cleanLabel(r.description),
    values,
    flags: r.flags.map((v, i) => ({ col: ["ST", "SV", "GB"][i], v })),
    unit: r.unit,
    extra: [],
    mode: "heuristic",
    ambiguous,
  };
}

// ------------------------------------------------------------------ rows -> values

function finishRow(raw: RawRow, source: string, labelMap: LabelMap): ParsedRow {
  const cat = categorize(raw.label, labelMap);
  const c = CATEGORIES[cat.id];
  const v = raw.values;
  const amount = v.amount;
  let qty = v.qty;
  let unit = raw.unit && !/^(std|h)$/i.test(raw.unit) ? raw.unit : undefined;
  if (qty === undefined && v.days !== undefined && c.quantity === "units") {
    qty = v.days;
    unit ??= "Tage";
  }
  if (qty === 0 && amount) qty = undefined;
  let rate: number | undefined;
  let baseRate: number | undefined;
  if (v.zuab) {
    rate = v.zuab;
    baseRate = v.rate || undefined;
  } else rate = v.rate || undefined;
  const hours = c.quantity === "hours" && !unit ? qty : undefined;
  const quantity = hours === undefined ? qty : undefined;
  if (quantity !== undefined && !unit && raw.mode === "columns") unit = "Menge";
  const stFlag = raw.flags.find((f) => f.col === "ST" || f.col === "LST" || f.col === "ST/SV")?.v ?? (raw.mode === "heuristic" ? raw.flags[0]?.v : undefined);
  const taxFree = stFlag === "F" || (v.taxable === 0 && !!amount && amount > 0);

  let confidence: Confidence = "sicher";
  let note: string | undefined;
  const q = hours ?? quantity;
  if (amount === undefined) {
    confidence = "unsicher";
    note = "no amount found";
  } else if (q !== undefined && rate !== undefined) {
    if (!near(q * rate, amount)) {
      confidence = "pruefen";
      note = `quantity × rate = ${(q * rate).toFixed(2)} does not match the amount`;
    }
  } else if (raw.mode === "heuristic") {
    confidence = "pruefen";
    note = q !== undefined ? "no rate column found" : "only an amount found";
  } else if (q !== undefined && amount !== 0 && c.quantity === "units") {
    note = "the quantity is not hours (e.g. km or days)";
  }
  if (raw.ambiguous) {
    confidence = "pruefen";
    note = [note, "the columns of this line were not clear"].filter(Boolean).join("; ");
  }
  if (raw.mode === "heuristic" && !raw.code && confidence === "sicher") confidence = "pruefen";
  if (cat.id === "other") {
    confidence = "unsicher";
    note = "not recognised: choose what this line is";
  }
  return {
    code: raw.code,
    label: raw.label,
    category: cat.id,
    by: cat.by,
    hours,
    quantity,
    unit,
    rate,
    baseRate,
    amount,
    taxable: v.taxable,
    svable: v.svable,
    taxFree,
    confidence,
    source,
    note,
  };
}

function toLine(r: ParsedRow): ParsedLine {
  return { hours: r.hours, rate: r.rate, baseRate: r.baseRate, amount: r.amount, unit: r.unit, confidence: r.confidence, source: r.source, note: r.note };
}

function mergeLines(a: ParsedLine, b: ParsedLine): ParsedLine {
  const add = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : r2((x ?? 0) + (y ?? 0)));
  return {
    hours: add(a.hours, b.hours),
    amount: add(a.amount, b.amount),
    rate: a.rate === b.rate ? a.rate : undefined,
    baseRate: a.baseRate === b.baseRate ? a.baseRate : undefined,
    unit: a.unit,
    confidence: "pruefen",
    source: `${a.source}\n${b.source}`,
    note: "several payslip lines were added up (e.g. 25 % and 40 % night): check",
  };
}

// ------------------------------------------------------------------ month

function findMonth(lines: string[]): Parsed<string> | undefined {
  const mm = (n: number) => String(n).padStart(2, "0");
  const nameRe = new RegExp(`\\b(${MONTHS.join("|")})\\b(?:\\s+(\\d{4}))?`, "i");
  for (const l of lines) {
    let m = /abrechnungs\s*-?\s*(?:monat|zeitraum|periode)\s*:?\s*(\d{1,2})\s*[./]\s*(\d{4})/i.exec(l);
    if (m) return { value: `${m[2]}-${m[1]!.padStart(2, "0")}`, confidence: "sicher", source: l };
    m = new RegExp(`abrechnungs\\s*-?\\s*(?:monat|zeitraum|periode)\\s*:?\\s*(${MONTHS.join("|")})\\s+(\\d{4})`, "i").exec(l);
    if (m) return { value: `${m[2]}-${mm(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}`, confidence: "sicher", source: l };
    // DATEV style "Abrechnung der Brutto/Netto-Bezüge für September 2026"
    m = new RegExp(`(?:abrechnung|bezüge|entgelt|lohn)\\S*\\b.*\\bfür\\s+(?:den\\s+monat\\s+)?(${MONTHS.join("|")})\\s+(\\d{4})`, "i").exec(l);
    if (m) return { value: `${m[2]}-${mm(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}`, confidence: "sicher", source: l };
  }
  // period "01.09.-30.09.2026" / "01.09.2026 - 30.09.2026"
  let period: Parsed<string> | undefined;
  for (const l of lines) {
    const m = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*(?:-|–|bis)\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(l);
    if (!m) continue;
    const [, d1, m1, , d2, m2, y] = m;
    if (Number(m1) !== Number(m2) || Number(m2) < 1 || Number(m2) > 12) continue;
    const last = new Date(Date.UTC(Number(y), Number(m2), 0)).getUTCDate();
    const full = Number(d1) === 1 && Number(d2) === last;
    period = { value: `${y}-${mm(Number(m2))}`, confidence: full ? "sicher" : "pruefen", source: l, note: full ? undefined : "the period is not a full month" };
    break;
  }
  // month name next to "Abrechnungs-Monat"
  for (let i = 0; i < lines.length; i++) {
    if (!/abrechnungs\s*-?\s*monat|abrechnungsmonat|monat\s*\/\s*jahr/i.test(lines[i]!)) continue;
    for (const l of lines.slice(i, i + 3)) {
      const m = nameRe.exec(l);
      if (!m) continue;
      const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
      const year = m[2] ?? period?.value.slice(0, 4);
      if (!year) continue;
      const value = `${year}-${mm(month)}`;
      if (period && period.value !== value) return { value: period.value, confidence: "pruefen", source: period.source, note: `the month name (${m[1]}) and the period disagree` };
      return { value, confidence: "sicher", source: l };
    }
  }
  if (period) return period;
  for (const l of lines) {
    const m = /\b(0[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/.exec(l);
    if (m) return { value: `${m[2]}-${m[1]}`, confidence: "unsicher", source: l, note: "guessed from a date in the text" };
  }
  return undefined;
}

// ------------------------------------------------------------------ main

export function parsePayslipLines(input: (string | TextLine)[], opts: ParseOptions = {}): ParsedPayslip {
  const all = toTextLines(input.map((l) => (typeof l === "string" ? l.replace(/\t/g, "  ") : l)));
  const texts = all.map((l) => l.text);
  const { profile } = detectProfile(texts.join("\n"), opts.producer);
  active = profile;
  try {
    return parseDetected(all, texts, profile, opts);
  } finally {
    active = GENERIC;
  }
}

function parseDetected(all: TextLine[], texts: string[], profile: Profile, opts: ParseOptions): ParsedPayslip {
  const labelMap = opts.labelMap ?? {};
  const headerIdx = all.findIndex((l) => detectHeader(l));
  let result = parseWith(all, labelMap, headerIdx >= 0);
  // a header was found but no row could be read from it: fall back to the end-of-line numbers
  if (headerIdx >= 0 && result.rows.length === 0) result = parseWith(all, labelMap, false);
  result.profile = { id: profile.id, name: profile.name, checked: profile.checked, note: profile.note };
  result.month = findMonth(texts.filter((t) => !result.ytd.includes(t)));
  return result;
}

function parseWith(all: TextLine[], labelMap: LabelMap, useHeader: boolean): ParsedPayslip {
  const out: ParsedPayslip = {
    profile: { id: "generic", name: "", checked: false, note: "" },
    table: "none",
    lines: {},
    rows: [],
    other: [],
    summary: {},
    info: [],
    ytd: [],
    unmatched: [],
    checks: [],
  };
  const addInfo = (label: string, value: string) => {
    if (!out.info.some((i) => i.label === label)) out.info.push({ label, value });
  };
  const setTotal = (field: SummaryField, value: number, confidence: Confidence, source: string, note?: string) => {
    const prev = out.summary[field];
    if (prev && !(prev.confidence !== "sicher" && confidence === "sicher")) return;
    out.summary[field] = { value, confidence, source, ...(note ? { note } : {}) };
  };
  const usePair = (p: { label: string; raw: string; value: number }, l: TextLine, block: boolean) => {
    const t = matchTotal(p.label, l.text);
    if (t) {
      let conf = t.rule.confidence;
      let note: string | undefined;
      if (t.rule.field === "azkSaldo" && conf === "pruefen") note = "balance of the Gleitzeit/AZK account (hours): check";
      if (block) note = [note, "read from a label row with the value below"].filter(Boolean).join("; ");
      if (block && conf === "sicher" && t.rule.field === "azkSaldo") conf = "pruefen";
      setTotal(t.rule.field, p.value, conf, l.text, note);
      if (!["gesamtbrutto", "steuerfrei", "azkSaldo", "stundenlohn"].includes(t.rule.field)) addInfo(t.text, p.raw);
      return true;
    }
    if (isInfoLabel(p.label) || block) {
      addInfo(cleanLabel(p.label), p.raw);
      return true;
    }
    return false;
  };
  const addRow = (raw: RawRow, source: string) => {
    const row = finishRow(raw, source, labelMap);
    out.rows.push(row);
    const line = CATEGORIES[row.category].line;
    if (line) {
      const prev = out.lines[line];
      out.lines[line] = prev ? mergeLines(prev, toLine(row)) : toLine(row);
    } else {
      out.other.push(row);
      if (row.category === "other") out.unmatched.push(source);
    }
  };

  let header: Header | null = null;
  let inTable = false;
  let textOnly = 0;
  let ytdMode = false;
  let pending: { groups: { label: string; x: number }[]; ttl: number } | null = null;

  for (const l of all) {
    const text = l.text;
    const h = useHeader ? detectHeader(l) : null;
    if (h) {
      header = h;
      inTable = true;
      textOnly = 0;
      ytdMode = false;
      pending = null;
      out.table = "columns";
      continue;
    }
    if (ytdMode) {
      if (/^(?:abrechnungs|entgeltabrechnung|verdienstabrechnung|lohnabrechnung|seite\s+\d)/i.test(text)) ytdMode = false;
      else {
        out.ytd.push(text);
        continue;
      }
    }
    for (const f of HEADER_FACTS) {
      const m = f.match.exec(text);
      if (m) addInfo(f.label, m[1]!.trim());
    }

    const groups = groupTokens(l.tokens).map((g) => cleanLabel(joinTokens(g)));
    if (inTable && header) {
      const first = groups[0] ?? "";
      const end = TABLE_END.test(first) || isYtdHead(first) || groups.some((g) => isYtdHead(g)) || labelRow(l) || groups.some((g) => !!matchTotal(g, text) && !/\d/.test(g) && g === first);
      if (!end) {
        const raw = parseColumnRow(l, header);
        if (raw) {
          addRow(raw, text);
          textOnly = 0;
          continue;
        }
        if (++textOnly < 3) continue;
      }
      inTable = false;
    }

    // year-to-date heading: "Jahressummen" (block below) or "Jahreswerte: ... kumuliert 1.234,56" (inline)
    const ytdHeading = groups.some((g) => isYtdHead(g));
    const { pairs, loose } = linePairs(l);
    if (ytdHeading) {
      const inlineYtd = pairs.some((p) => YTD_WORD.test(p.label) && p.raw.includes(","));
      for (const p of pairs) if (!YTD_WORD.test(p.label) && !isYtdHead(p.label)) usePair(p, l, false);
      out.ytd.push(text);
      if (!inlineYtd) ytdMode = true;
      pending = null;
      continue;
    }
    if (pairs.some((p) => YTD_WORD.test(p.label))) {
      out.ytd.push(text);
      for (const p of pairs) if (!YTD_WORD.test(p.label)) usePair(p, l, false);
      continue;
    }

    // values below a label row
    if (pending && loose.length) {
      const used = new Set<string>();
      for (const t of loose) {
        const c = t.x + t.w / 2;
        const left = pending.groups.filter((g) => g.x <= c + 4);
        const g = left.length ? left[left.length - 1]! : [...pending.groups].sort((a, b) => Math.abs(a.x - c) - Math.abs(b.x - c))[0]!;
        if (used.has(g.label)) continue; // two values under one label: unclear, keep the first
        used.add(g.label);
        usePair({ label: g.label, raw: t.s, value: tokNum(t.s)! }, l, true);
      }
      pending = null;
    } else if (pending && --pending.ttl <= 0) pending = null;
    const lr = labelRow(l);
    if (lr) {
      pending = { groups: lr, ttl: 2 };
      continue;
    }

    // rows without a table header (only when no header was found)
    const startsWithCode = /^\d{3,5}\s+\S*[a-zäöüß]/i.test(text);
    if (!useHeader && startsWithCode) {
      const raw = heuristicRow(text);
      if (raw) {
        addRow(raw, text);
        out.table = "heuristic";
        continue;
      }
    }
    let used = false;
    for (const p of pairs) used = usePair(p, l, false) || used;
    if (used || useHeader) continue;
    if (/:\s/.test(text)) continue; // header "Label: value" lines
    const raw = heuristicRow(text);
    if (raw && categorize(raw.label, labelMap).id !== "other") {
      addRow(raw, text);
      out.table = "heuristic";
    }
  }

  // a header "Stundenlohn: 14,50" confirms the base rate
  const sl = out.summary.stundenlohn;
  const g = out.lines.grundlohn;
  if (sl && g && g.rate !== undefined && Math.abs(g.rate - sl.value) > 0.005) {
    g.confidence = "unsicher";
    g.note = `the header says Stundenlohn ${sl.value.toFixed(2)}, the row says ${g.rate.toFixed(2)}`;
  }

  // cross-checks: the rows must add up to the payslip's totals
  const sum = (f: (r: ParsedRow) => number | undefined, rows = out.rows) => r2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
  const grossRows = out.rows.filter((r) => CATEGORIES[r.category].gross);
  const check = (id: CrossCheck["id"], label: string, rows: number, total?: Parsed<number>) => {
    if (!total) return;
    const ok = Math.abs(rows - total.value) <= 0.02;
    out.checks.push({ id, label, rows, total: total.value, ok });
    if (!ok && total.confidence === "sicher" && id === "gross") total.confidence = "pruefen";
    if (!ok) total.note = [total.note, `the table rows add up to ${rows.toFixed(2)}`].filter(Boolean).join("; ");
  };
  if (out.rows.length) {
    check("gross", "Rows added up vs. gross total", sum((r) => r.amount, grossRows), out.summary.gesamtbrutto);
    if (out.rows.some((r) => r.taxable !== undefined)) check("taxable", "Taxable column vs. Steuerbrutto", sum((r) => r.taxable), out.summary.steuerbrutto);
    if (out.rows.some((r) => r.svable !== undefined)) check("svable", "SV column vs. SV-Brutto", sum((r) => r.svable), out.summary.svbrutto);
    const taxFree = out.rows.some((r) => r.taxable !== undefined)
      ? sum((r) => (r.amount !== undefined && r.taxable !== undefined ? r.amount - r.taxable : undefined), grossRows)
      : sum((r) => (r.taxFree ? r.amount : undefined), grossRows);
    if (out.rows.some((r) => r.taxFree)) check("taxfree", "Tax-free rows vs. steuerfrei total", taxFree, out.summary.steuerfrei);
  }
  return out;
}

/** Fields found, for "did we recognise a payslip at all?" */
export function foundCount(p: ParsedPayslip): number {
  return p.rows.length + Object.keys(p.summary).length;
}
