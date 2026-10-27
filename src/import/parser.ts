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

export type SummaryField =
  | "gesamtbrutto"
  | "steuerbrutto"
  | "svbrutto"
  | "steuerfrei"
  | "netto"
  | "auszahlung"
  | "abzuege"
  | "steuerAbzuege"
  | "svAbzuege"
  | "nettoAbzuege"
  | "azkSaldo"
  | "gesStunden"
  | "stundenlohn";

export const SUMMARY_LABEL: Record<SummaryField, string> = {
  gesamtbrutto: "Gesamtbrutto",
  steuerbrutto: "Steuerbrutto",
  svbrutto: "SV-Brutto",
  steuerfrei: "davon steuerfrei",
  netto: "Netto",
  auszahlung: "Auszahlung",
  abzuege: "Gesetzliche Abzüge",
  steuerAbzuege: "Steuerrechtl. Abzüge",
  svAbzuege: "SV-rechtl. Abzüge",
  nettoAbzuege: "Sonstige Netto-Be-/Abzüge",
  azkSaldo: "AZK / Gleitzeit balance",
  gesStunden: "Total hours",
  stundenlohn: "Stundenlohn",
};

export interface CrossCheck {
  id: "gross" | "taxable" | "svable" | "taxfree" | "net" | "payout";
  label: string;
  /** sum of the table rows */
  rows: number;
  /** the payslip's own total */
  total: number;
  ok: boolean;
}

/** hourly wage (per-hour checks apply) or monthly salary (only the totals can be compared) */
export type PayType = "hourly" | "salary";

/** overall confidence of the import, with the reasons in plain words */
export interface ImportQuality {
  level: Confidence;
  reasons: string[];
}

export interface ParsedPayslip {
  profile: { id: ProfileId; name: string; checked: boolean; note: string; score: number };
  /** every layout profile with its marker score, best first */
  profileScores: { id: ProfileId; name: string; score: number }[];
  payType: PayType;
  payTypeReason: string;
  quality: ImportQuality;
  /** lines that were read but deliberately not used (Σ / Gesamtsumme rows that repeat values) */
  ignored: { text: string; reason: string }[];
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

/**
 * A number token. OCR noise around it is removed ("„123,45", "123,45|") and an OCR'd decimal
 * point is accepted when it cannot be a thousands separator ("123.45", "1.234.56": 2 digits).
 */
export const tokNum = (s: string) => {
  const t = s.replace(/^[„"'‚‘’_]+/, "").replace(/[;|_'’]+$/, "");
  const n = parseGermanNumber(t);
  if (n !== null) return n;
  const m = /^([+-]?(?:\d{3,}|\d{1,3}(?:\.\d{3})+))\.(\d{2})(-?)$/.exec(t);
  if (m) return parseGermanNumber(`${m[1]},${m[2]}${m[3]}`);
  // OCR lost the decimal comma after a thousands group: "1.23456" can only be 1.234,56
  const k = /^(\d{1,3}\.\d{3})(\d{2})(-?)$/.exec(t);
  return k ? parseGermanNumber(`${k[1]},${k[2]}${k[3]}`) : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.001);
const UNIT_RE = /^(tage?|std\.?|h|stk\.?|km|€|eur|%)$/i;
/** flag letters (L, F, J, N, E, S, M, V ...) and "*" in the St / SV / GB columns */
const FLAG_RE = /^(?:[A-Z]{1,2}|\*)$/;

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
  {
    field: "abzuege",
    re: /^(?:summe\s+(?:der\s+)?gesetzl(?:ichen?|icher|\.)?\s*abzüge|gesetzliche\s+abzüge|summe\s+abzüge|abzüge\s+gesamt|gesamt\s*-?\s*abzüge)$/,
    confidence: "sicher",
  },
  { field: "steuerAbzuege", re: /^(?:steuerrechtl(?:iche)?\.?\s*abzüge|steuer\s*-?\s*abzüge|summe\s+steuern?)$/, confidence: "sicher" },
  { field: "svAbzuege", re: /^(?:sv\s*-?\s*rechtl(?:iche)?\.?\s*abzüge|sv\s*-?\s*abzüge|summe\s+sv(?:\s*-?\s*beiträge)?|sozialversicherungs\s*-?\s*abzüge)$/, confidence: "sicher" },
  {
    field: "nettoAbzuege",
    re: /^(?:summe\s+sonst(?:ige)?\.?\s*abzüge(?:\s*\/\s*zuzahlungen)?|sonstige\s+abzüge|netto\s*-?\s*abzüge|(?:summe\s+)?netto\s*-?\s*be\s*-?\s*\/\s*abzüge)$/,
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
  /^(?:lohnst|lohnsteuer|kirch|kist|soli|solidarit|kranken|kv\b|kv-|renten|rentvers|rv\b|rv-|arbeitslos|arblos|av\b|pflege|pv\b|kammer|umlage|sachbez|jahr-?\s*ausgl|lst-?\s*jahres|vwl|vorschuss|pfändung|abzüge|end-?\s*summe|summe\s+abzüge|netto|nettobe|gesetzliche|sozialvers|an-?\s*ant|winterbesch|urlaubsanspruch|resturlaub|urlaub\s*-?\s*(?:vorjahr|genommen|monatlich)|tätigkeitsschl|personengruppe|st\.?\s*kl\b|steuerrechtl|sv\s*-?\s*rechtl)/i;

/** vacation day counts in the header (Urlaubsanspruch, Resturlaub ...): info, never the vacation pay line */
const VACATION_FACT = /^(?:urlaubsanspruch|resturlaub|rest\s*-?\s*urlaub|urlaub\s*-?\s*(?:vorjahr|genommen|monatlich))/i;

/** header facts in "Label: value" form */
const HEADER_FACTS: { label: string; match: RegExp }[] = [
  { label: "Arbeitnehmer", match: /arbeitnehmer(?:in)?\s*:\s*(.+?)(?:\s{2,}|\s+personal-?nr|$)/i },
  { label: "Einsatzbetrieb", match: /einsatzbetrieb\s*:\s*(.+)$/i },
  { label: "Tarif", match: /tarif(?:vertrag)?\s*:\s*([^\s].*?)(?:\s+entgeltgruppe|$)/i },
  { label: "Entgeltgruppe", match: /entgeltgruppe\s*:?\s*((?:EG\s*)?\d[ab]?)\b/i },
  { label: "Personengruppe", match: /personengruppe\s*:?\s*(\d{3})\b/i },
  { label: "Tätigkeitsschlüssel", match: /tätigkeitsschl(?:üssel|\.)?\s*:?\s*(\d{9})\b/i },
  { label: "St.Kl.", match: /\b(?:st\.?\s*kl\.?|steuerklasse)\s*:?\s*([1-6])\b/i },
];

const YTD_WORD = /kumuliert|\bkum\.|jahreswert|jahressumme|jahres\s*-\s*summ|lfd\.?\s*jahr|\bytd\b|seit\s+jahresbeginn|bis\s+lfd|aufgelaufen/i;
const isYtdHead = (s: string) => YTD_HEAD.test(s) || active.ytdHeadings.some((re) => re.test(s));
const YTD_HEAD = /^(?:jahres\s*-?\s*summen|jahreswerte|jahresübersicht|jahres\s*-?\s*kumul|kumulierte\s+werte|summen\s+(?:lfd\.?\s*|laufendes\s+)?jahr|werte\s+seit\s+jahresbeginn|aufgelaufene?\s+jahres)/i;
/** a year-to-date block that sits on the LEFT, beside month values on the right (Lexware style) */
const YTD_LEFT_HEAD = /^aufgelaufene?\s+jahres/i;
/** Σ / Gesamtsumme rows repeat the values above them */
const SIGMA_ROW = /^(?:[Σ∑]|gesamtsumme\b)/i;
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
  w: number;
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
      if (label && /[a-zäöüß]/i.test(label)) pairs.push({ label: cleanLabel(label), raw: t.s.replace(/[;|]+$/, ""), value: n, x: t.x, w: t.w });
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

interface LabelCell {
  label: string;
  x: number;
  right: number;
}

/**
 * A row of labels with the values on the next line (zvoove: "Ges. Stunden  Gleitzeit  KrankenVers.",
 * Lexware: "Steuer-Brutto  Lohnsteuer ..." grid cells). A single label counts only when it is a
 * total ("Nettoentgelt" with its value below); its value must then sit directly below it.
 */
function labelRow(l: TextLine): LabelCell[] | null {
  if (l.tokens.some((t) => tokNum(t.s) !== null)) return null;
  const groups = groupTokens(l.tokens)
    .map((g) => ({ label: cleanLabel(joinTokens(g)), x: g[0]!.x, right: g[g.length - 1]!.x + g[g.length - 1]!.w }))
    .filter((g) => g.label && !/^[|;]+$/.test(g.label));
  if (!groups.length) return null;
  if (groups.length === 1) return matchTotal(groups[0]!.label, l.text) ? groups : null;
  if (!groups.some((g) => isKnownLabel(g.label, l.text))) return null;
  return groups;
}

const overlaps = (g: LabelCell, t: Token) => Math.min(t.x + t.w, g.right + 6) - Math.max(t.x, g.x - 6) > 0;

/** the label cell a value below belongs to: the cell it overlaps most, else the nearest one to its left */
function cellFor(groups: LabelCell[], t: Token): LabelCell | undefined {
  const a = t.x;
  const b = t.x + t.w;
  let best: LabelCell | undefined;
  let bestOv = 0;
  for (const g of groups) {
    const ov = Math.min(b, g.right + 6) - Math.max(a, g.x - 6);
    if (ov > bestOv) {
      bestOv = ov;
      best = g;
    }
  }
  if (best) return best;
  if (groups.length === 1) return undefined;
  const c = t.x + t.w / 2;
  const left = groups.filter((g) => g.x <= c + 4);
  return left.length ? left[left.length - 1]! : [...groups].sort((p, q) => Math.abs(p.x - c) - Math.abs(q.x - c))[0];
}

// ------------------------------------------------------------------ table header

/** `ytd`: a year-to-date column (Jahressummen): its values are never the month amount */
type ColKind = "code" | "label" | "cost" | "days" | "qty" | "rate" | "zuab" | "flag" | "taxable" | "svable" | "amount" | "ytd";

const HEADER_WORDS: [ColKind, RegExp][] = [
  ["code", /^(?:nr\.?|lohnart-?nr\.?|la|lart|la-?nr\.?|schl\.?|schlüssel|nummer|lohnart|lohnarten?-?nr\.?)$/i],
  ["label", /^(?:lohnartbezeichnung|lohnarten-?bezeichnung|lohnart-?bezeichnung|bezeichnung|lohnartentext|text|beschreibung|bezüge)$/i],
  ["cost", /^(?:kst\.?|kostenstelle|kostenst\.?|kostenträger|kostentr\.?|kst\.?-?st\.?)$/i],
  ["days", /^tage$/i],
  ["qty", /^(?:stunden|std\.?|menge|anzahl|std\.?\/tage|stk\.?|einheit|einheiten|menge\/std\.?|stunden\/einheit|std\.?\/einheit)$/i],
  ["rate", /^(?:satz|faktor|lohnsatz|stundensatz|preis|einzelbetrag|€\/std\.?|€\/h)$/i],
  ["zuab", /^(?:zu\/ab|zu-?\/abschlag|zuschlag|zuschlagssatz|zuschlag\s*%|zuschl\.?)$/i],
  ["flag", /^(?:st|sv|gb|kz|lst|st\/sv|sv\/st|gb\/st\/sv|st\/sv\/gb)$/i],
  ["ytd", /^(?:jahressummen?|jahreswerte?|kumuliert|kum\.?|lfd\.?jahr|ytd)$/i],
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

/** "St*" -> "St", "%-Zuschlag" -> "Zuschlag", "Betrag:" -> "Betrag" */
const normHeader = (s: string) => ocrTrim(s).replace(/[:*]+$/, "").replace(/^%\s*-?\s*/, "");
/** OCR noise at the edges of a header word: "___Lohn-", "_GB/ST/SV", "Betrag|" */
const ocrTrim = (s: string) => s.replace(/^[_|—–.„"'‚]+/, "").replace(/[_|]+$/, "");

/**
 * Two-line headers ("Kosten-" over "stelle", "Zuschlags-" over "satz", "Stunden/" over "Einheit"):
 * a word ending in "-" or "/" is joined with the word directly below it.
 */
export function joinHeaderLines(a: TextLine, b: TextLine): TextLine | null {
  const ends = (t: Token) => /[-/]$/.test(ocrTrim(t.s));
  if (!a.tokens.some(ends)) return null;
  if (b.tokens.length > 14 || b.tokens.some((t) => tokNum(t.s) !== null)) return null;
  const used = new Set<number>();
  const joined = a.tokens.map((t0) => {
    if (!ends(t0)) return t0;
    const t = { ...t0, s: ocrTrim(t0.s) };
    const i = b.tokens.findIndex((u, k) => !used.has(k) && u.x < t.x + Math.max(t.w, 20) + 6 && u.x + u.w > t.x - 6);
    if (i < 0) return t;
    used.add(i);
    const u = b.tokens[i]!;
    const us = ocrTrim(u.s);
    const s = t.s.endsWith("-") && /^[a-zäöüß]/.test(us) ? t.s.slice(0, -1) + us : t.s + us;
    return { ...t, s, w: Math.max(t.x + t.w, u.x + u.w) - t.x };
  });
  if (!used.size) return null;
  const tokens = [...joined, ...b.tokens.filter((_, k) => !used.has(k))].sort((p, q) => p.x - q.x);
  return { text: tokens.map((t) => t.s).join(" "), tokens, ...(a.ocr ? { ocr: true } : {}) };
}

/** the table header at line i, also when it is printed on two lines */
function headerAt(all: TextLine[], i: number): { h: Header; span: 1 | 2 } | null {
  const l = all[i]!;
  const h = detectHeader(l);
  if (h) return { h, span: 1 };
  const next = all[i + 1];
  const j = next ? joinHeaderLines(l, next) : null;
  const h2 = j ? detectHeader(j) : null;
  return h2 ? { h: h2, span: 2 } : null;
}

function detectHeader(l: TextLine): Header | null {
  if (l.tokens.length < 3 || l.tokens.length > 20) return null;
  const cols: Column[] = [];
  let unknown = 0;
  for (const t of l.tokens) {
    const s = normHeader(t.s);
    if (!s) continue;
    if (/^(?:€|eur)$/i.test(s) && cols.length) {
      cols[cols.length - 1]!.right = t.x + t.w;
      continue;
    }
    const own = Object.entries(active.headers).find(([, words]) => words?.some((w) => normHeader(w).toLowerCase() === s.toLowerCase()));
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
  const perFlagCol = new Map<Column, number>();
  l.tokens.forEach((t, i) => {
    const centre = t.x + t.w / 2;
    if (centre < h.labelEnd) {
      if (i === 0 && (h.codeCol ? /^\d{1,6}$/.test(t.s) && t.x < h.labelX - 1 : /^\d{2,6}$/.test(t.s) && l.tokens.length > 2)) code = t.s;
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
      const fc = [...flagCols].sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0]!;
      // combined "GB/ST/SV" column: the n-th flag belongs to the n-th part
      const parts = fc.name.toUpperCase().split("/");
      const k = perFlagCol.get(fc) ?? 0;
      perFlagCol.set(fc, k + 1);
      flags.push({ col: parts.length > 1 ? (parts[k] ?? parts[parts.length - 1]) : fc.name.toUpperCase(), v: t.s });
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
    if (/^(?:[LFJNESMVP]|\*)$/.test(t)) {
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
  let zuabNote: string | undefined;
  if (v.zuab) {
    const base = v.rate;
    if (qty && base && amount !== undefined && v.zuab === 100 && near(qty * base, amount) && cat.id === "holidayPay") {
      // Lexware "Feiertagsstunden ... %-Zuschlag 100": the hours are paid at 100 % of the rate, not +100 %
      rate = base;
      zuabNote = "paid at 100 % of the rate (paid public holiday, not a +100 % surcharge)";
    } else if (qty && base && amount !== undefined && near(qty * base * (v.zuab / 100), amount)) {
      // percentage surcharge column (%-Zuschlag, Zuschlagssatz): rate = Satz x %
      rate = (base * v.zuab) / 100;
      baseRate = base;
      zuabNote = `surcharge ${v.zuab.toLocaleString("de-DE")} % of ${base.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €/h`;
    } else {
      // zvoove: Zu/Ab is the surcharge in €/h, Satz the hourly rate it was calculated on
      rate = v.zuab;
      baseRate = base || undefined;
    }
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
  if (zuabNote) note = [note, zuabNote].filter(Boolean).join("; ");
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
    // "Abrechnung der Brutto-Netto-Bezüge ... November 2026"
    let m = new RegExp(`abrechnung\\S*(?:\\s+\\S+){0,6}?\\s+(${MONTHS.join("|")})\\s+(20\\d{2})\\b`, "i").exec(l);
    if (m) return { value: `${m[2]}-${mm(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}`, confidence: "sicher", source: l };
    // "Lohn- und Gehaltsabrechnung 04.2026" (MM.YYYY right after the title, never part of a date)
    m = /abrechnung\S*(?:\s+\S+){0,4}?\s+(0[1-9]|1[0-2])\.(20\d{2})(?![.\d])/i.exec(l);
    if (m) return { value: `${m[2]}-${m[1]}`, confidence: "sicher", source: l };
  }
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
  const detected = detectProfile(texts.join("\n"), opts.producer);
  active = detected.profile;
  try {
    return parseDetected(all, texts, detected, opts);
  } finally {
    active = GENERIC;
  }
}

function parseDetected(all: TextLine[], texts: string[], detected: ReturnType<typeof detectProfile>, opts: ParseOptions): ParsedPayslip {
  const profile: Profile = detected.profile;
  const labelMap = opts.labelMap ?? {};
  const headerIdx = all.findIndex((_, i) => headerAt(all, i));
  let result = parseWith(all, labelMap, headerIdx >= 0);
  // a header was found but no row could be read from it: fall back to the end-of-line numbers
  if (headerIdx >= 0 && result.rows.length === 0) result = parseWith(all, labelMap, false);
  result.profile = { id: profile.id, name: profile.name, checked: profile.checked, note: profile.note, score: detected.score };
  result.profileScores = detected.scores;
  result.month = findMonth(texts.filter((t) => !result.ytd.includes(t)));
  result.quality = assessQuality(result);
  return result;
}

function parseWith(all: TextLine[], labelMap: LabelMap, useHeader: boolean): ParsedPayslip {
  const out: ParsedPayslip = {
    profile: { id: "generic", name: "", checked: false, note: "", score: 0 },
    profileScores: [],
    payType: "hourly",
    payTypeReason: "",
    quality: { level: "unsicher", reasons: [] },
    ignored: [],
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
  // the original text line of the value (also when only a part of it is parsed), for OCR marking
  let curSource = "";
  const usePair = (p: { label: string; raw: string; value: number }, l: TextLine, block: boolean, extraNote?: string, check = false) => {
    const t = matchTotal(p.label, l.text);
    if (t) {
      let conf = t.rule.confidence;
      let note: string | undefined = extraNote;
      if (check && conf === "sicher") conf = "pruefen";
      if (t.rule.field === "azkSaldo" && conf === "pruefen") note = "balance of the Gleitzeit/AZK account (hours): check";
      if (block) note = [note, "read from a label row with the value below"].filter(Boolean).join("; ");
      if (block && conf === "sicher" && t.rule.field === "azkSaldo") conf = "pruefen";
      setTotal(t.rule.field, p.value, conf, curSource || l.text, note);
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
  // the Σ row right below the wage table: some layouts print the month's gross only there
  let sigmaGross: Parsed<number> | undefined;
  let textOnly = 0;
  /** year-to-date block: tokens left of xMax are year values (Infinity = the whole line) */
  let ytdMode: { xMax: number } | null = null;
  let pending: { groups: LabelCell[]; ttl: number } | null = null;
  /** "Monat | Jahr" value blocks (WERTE): numbers under a Jahr column are year values */
  let monthYear: { monat: number[]; jahr: number[]; ttl: number } | null = null;
  let salaryHint = false;
  const PAGE_HEAD = /^(?:abrechnungs|entgeltabrechnung|verdienstabrechnung|lohnabrechnung|seite\s+\d)/i;
  const sub = (l: TextLine, tokens: Token[]): TextLine => ({ text: tokens.map((t) => t.s).join(" "), tokens, ...(l.ocr ? { ocr: true } : {}) });

  for (let i = 0; i < all.length; i++) {
    let l = all[i]!;
    curSource = l.text;
    const hd = useHeader ? headerAt(all, i) : null;
    if (hd) {
      header = hd.h;
      inTable = true;
      textOnly = 0;
      ytdMode = null;
      monthYear = null;
      pending = null;
      out.table = "columns";
      i += hd.span - 1;
      continue;
    }
    if (ytdMode) {
      if (PAGE_HEAD.test(l.text)) ytdMode = null;
      else {
        const xMax = ytdMode.xMax;
        // a token reaching into the right column belongs to it (labels there start a bit further left)
        const isRight = (t: Token) => t.x + t.w > xMax;
        const left = l.tokens.filter((t) => !isRight(t));
        const right = l.tokens.filter(isRight);
        if (left.length) out.ytd.push(xMax === Infinity ? l.text : sub(l, left).text);
        if (!right.length) continue;
        l = sub(l, right);
      }
    } else {
      // "Aufgelaufene Jahreswerte" block on the left, month values on the right of the same lines
      const hg = groupTokens(l.tokens).find((g) => YTD_LEFT_HEAD.test(cleanLabel(joinTokens(g))));
      if (hg) {
        const end = hg[hg.length - 1]!.x + hg[hg.length - 1]!.w;
        const next = l.tokens.find((t) => t.x > end + 30);
        const xMax = next ? next.x - 1 : Infinity;
        ytdMode = { xMax };
        inTable = false; // a label row above (right column) may still get its value on this line
        const right = l.tokens.filter((t) => t.x >= xMax);
        out.ytd.push(sub(l, l.tokens.filter((t) => t.x < xMax)).text);
        if (!right.length) continue;
        l = sub(l, right);
      }
    }
    // Σ / Gesamtsumme rows repeat the values above: listed, never used
    if (SIGMA_ROW.test(l.tokens[0]?.s ?? "") || /^\S{0,2}\s*gesamtsumme\b/i.test(l.tokens.slice(0, 2).map((t) => t.s).join(" "))) {
      out.ignored.push({ text: curSource, reason: "Σ / Gesamtsumme row: repeats the values above" });
      const upto = l.tokens.findIndex((t, k) => k > 0 && t.s === "|");
      const sigNums = (upto > 0 ? l.tokens.slice(0, upto) : l.tokens).map((t) => tokNum(t.s)).filter((n): n is number => n !== null);
      if (inTable && !sigmaGross && /^[Σ∑]/.test(l.tokens[0]?.s ?? "") && sigNums.length === 1)
        sigmaGross = { value: sigNums[0]!, confidence: "pruefen", source: curSource, note: "no gross total printed: taken from the Σ row below the wage table" };
      // a scan may show the next box of the page after a "|" border on the same line
      const bar = l.tokens.findIndex((t, k) => k > 0 && t.s === "|");
      const rest = bar > 0 ? l.tokens.slice(bar + 1).filter((t) => t.s !== "|") : [];
      if (!l.ocr || !rest.length) continue;
      l = sub(l, rest);
    }
    // "Monat | Jahr" value blocks
    const hasNum = l.tokens.some((t) => tokNum(t.s) !== null);
    if (!hasNum && l.tokens.some((t) => /^monat$/i.test(normHeader(t.s))) && l.tokens.some((t) => /^jahr$/i.test(normHeader(t.s)))) {
      const xs = (re: RegExp) => l.tokens.filter((t) => re.test(normHeader(t.s))).map((t) => t.x + t.w / 2);
      monthYear = { monat: xs(/^(?:monat|\(m\))$/i), jahr: xs(/^(?:jahr|\(j\))$/i), ttl: 10 };
      pending = null;
      inTable = false;
      continue;
    }
    if (monthYear) {
      if (--monthYear.ttl <= 0 || PAGE_HEAD.test(l.text)) monthYear = null;
      else if (hasNum) {
        const my = monthYear;
        const dist = (c: number, xs: number[]) => Math.min(...xs.map((x) => Math.abs(x - c)));
        const drop = l.tokens.filter((t) => tokNum(t.s) !== null && dist(t.x + t.w / 2, my.jahr) < dist(t.x + t.w / 2, my.monat));
        if (drop.length) {
          out.ytd.push(curSource);
          const keep = l.tokens.filter((t) => !drop.includes(t));
          if (!keep.length) continue;
          l = sub(l, keep);
        }
      }
    }
    const text = l.text;
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
        // vacation day counts and deduction rows inside the earnings grid are info, never wage rows
        if (raw && (VACATION_FACT.test(raw.label) || (isInfoLabel(raw.label) && categorize(raw.label, labelMap).id === "other"))) {
          const t = monthNumber(l, header);
          if (t) usePair({ label: raw.label, raw: t.s, value: tokNum(t.s)! }, l, false);
          textOnly = 0;
          continue;
        }
        if (raw) {
          addRow(raw, curSource);
          textOnly = 0;
          continue;
        }
        // "1000 Gehalt" whose amount could not be read: keep the row (it decides the pay type)
        const sal = /^(\d{1,6})?\s*((?:monats)?gehalt|monatslohn)\b/i.exec(text);
        if (sal) {
          salaryHint = true;
          addRow({ ...(sal[1] ? { code: sal[1] } : {}), label: sal[2]!, values: {}, flags: [], extra: [], mode: "columns", ambiguous: false }, curSource);
          textOnly = 0;
          continue;
        }
        if (++textOnly < 3) continue;
      }
      inTable = false;
    }

    // year-to-date heading: "Jahressummen" (block below) or "Jahreswerte: ... kumuliert 1.234,56" (inline)
    const ytdHeading = groups.some((g) => isYtdHead(g));
    const lp = linePairs(l);
    const loose = lp.loose;
    let pairs = lp.pairs;
    if (ytdHeading) {
      const inlineYtd = pairs.some((p) => YTD_WORD.test(p.label) && p.raw.includes(","));
      for (const p of pairs) if (!YTD_WORD.test(p.label) && !isYtdHead(p.label)) usePair(p, l, false);
      out.ytd.push(curSource);
      if (!inlineYtd) ytdMode = { xMax: Infinity };
      pending = null;
      continue;
    }
    if (pairs.some((p) => YTD_WORD.test(p.label))) {
      out.ytd.push(curSource);
      for (const p of pairs) if (!YTD_WORD.test(p.label)) usePair(p, l, false);
      continue;
    }

    // values below a label row; a number directly below a label cell belongs to it even when OCR
    // left a stray word before it ("A 1.234,56")
    const below = pending
      ? pairs.filter((p) => !isKnownLabel(p.label, text) && pending!.groups.some((g) => overlaps(g, { s: p.raw, x: p.x, w: p.w })))
      : [];
    if (below.length) pairs = pairs.filter((p) => !below.includes(p));
    const vals = [...loose, ...below.map((p) => ({ s: p.raw, x: p.x, w: p.w }))].sort((a, b) => a.x - b.x);
    if (pending && vals.length) {
      const used = new Set<LabelCell>();
      for (const t of vals) {
        const g = cellFor(pending.groups, t);
        if (!g || used.has(g)) continue; // two values under one label: unclear, keep the first
        used.add(g);
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
    if (!useHeader && startsWithCode && !VACATION_FACT.test(text.replace(/^\d+\s+/, ""))) {
      const raw = heuristicRow(text);
      if (raw) {
        addRow(raw, curSource);
        out.table = "heuristic";
        continue;
      }
    }
    let used = false;
    if (pairs.length === 1 && loose.length && loose[0]!.x > pairs[0]!.x && matchTotal(pairs[0]!.label, text)) {
      // a total with a second number on the line (GESAMTBRUTTO: month  year): take the one in the
      // amount column; without a table header take the first and ask the user to check
      const p = pairs[0]!;
      const cands = [{ s: p.raw, x: p.x, w: p.w }, ...loose.filter((t) => t.x > p.x)];
      const amountCol = header?.cols.find((c) => c.kind === "amount");
      const inAmount = amountCol ? cands.find((t) => Math.abs(t.x + t.w - amountCol.right) <= 45 || (t.x <= amountCol.right && t.x + t.w >= amountCol.x)) : undefined;
      if (inAmount) used = usePair({ ...p, raw: inAmount.s, value: tokNum(inAmount.s)! }, l, false, "a second number on this line (probably year-to-date) was not used");
      else used = usePair(p, l, false, "a second number on this line (probably year-to-date) was not used: check", true);
    } else for (const p of pairs) used = usePair(p, l, false) || used;
    if (used || useHeader) continue;
    if (/:\s/.test(text)) continue; // header "Label: value" lines
    if (VACATION_FACT.test(text)) continue;
    const raw = heuristicRow(text);
    if (raw && categorize(raw.label, labelMap).id !== "other") {
      addRow(raw, curSource);
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

  // pay type: a Gehalt / Monatslohn line, or a base line without hours and rate = monthly salary
  const baseRows = out.rows.filter((r) => r.category === "base");
  const salaryRow = baseRows.find((r) => SALARY_LABEL.test(r.label));
  if (salaryRow || salaryHint) {
    out.payType = "salary";
    out.payTypeReason = `the base line "${salaryRow?.label ?? "Gehalt"}" is a monthly salary`;
  } else if (baseRows.length && baseRows.every((r) => r.hours === undefined && r.rate === undefined && r.quantity === undefined && r.amount !== undefined)) {
    out.payType = "salary";
    out.payTypeReason = "the base line has an amount but no hours and no rate";
  } else {
    out.payType = "hourly";
    out.payTypeReason = baseRows.length ? "the base line has hours and a rate" : "no base line found: assumed hourly";
  }

  // cross-checks: the rows must add up to the payslip's totals, gross - deductions = net
  const S = out.summary;
  if (!S.gesamtbrutto && sigmaGross) S.gesamtbrutto = sigmaGross;
  const sum = (f: (r: ParsedRow) => number | undefined, rows = out.rows) => r2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
  const grossRows = out.rows.filter((r) => CATEGORIES[r.category].gross);
  const check = (id: CrossCheck["id"], label: string, rows: number, total?: Parsed<number>) => {
    if (!total) return;
    const ok = Math.abs(rows - total.value) <= 0.02;
    out.checks.push({ id, label, rows, total: total.value, ok });
    if (!ok && total.confidence === "sicher" && (id === "gross" || id === "net" || id === "payout")) total.confidence = "pruefen";
    if (!ok) total.note = [total.note, `${id === "gross" ? "the table rows add up to" : "expected from the other totals:"} ${rows.toFixed(2)}`].filter(Boolean).join("; ");
  };
  // a gross row whose amount could not be read: the rows cannot be added up
  const unreadable = grossRows.some((r) => r.amount === undefined);
  if (out.rows.length) {
    if (!unreadable) check("gross", "Rows added up vs. gross total", sum((r) => r.amount, grossRows), S.gesamtbrutto);
    if (out.rows.some((r) => r.taxable !== undefined)) check("taxable", "Taxable column vs. Steuerbrutto", sum((r) => r.taxable), S.steuerbrutto);
    if (out.rows.some((r) => r.svable !== undefined)) check("svable", "SV column vs. SV-Brutto", sum((r) => r.svable), S.svbrutto);
    const taxFree = out.rows.some((r) => r.taxable !== undefined)
      ? sum((r) => (r.amount !== undefined && r.taxable !== undefined ? r.amount - r.taxable : undefined), grossRows)
      : sum((r) => (r.taxFree ? r.amount : undefined), grossRows);
    if (out.rows.some((r) => r.taxFree)) check("taxfree", "Tax-free rows vs. steuerfrei total", taxFree, S.steuerfrei);
  }
  const deductions = S.abzuege
    ? Math.abs(S.abzuege.value)
    : S.steuerAbzuege || S.svAbzuege
      ? Math.abs(S.steuerAbzuege?.value ?? 0) + Math.abs(S.svAbzuege?.value ?? 0)
      : undefined;
  if (S.gesamtbrutto && deductions !== undefined) check("net", "Gross − statutory deductions vs. net", r2(S.gesamtbrutto.value - deductions), S.netto);
  // no gross total printed (some layouts show it only as a Σ row): the readable rows stand in
  else if (deductions !== undefined && grossRows.length && !unreadable)
    check("net", "Table rows − statutory deductions vs. net", r2(sum((r) => r.amount, grossRows) - deductions), S.netto);
  if (S.netto && S.auszahlung) {
    const adj = S.nettoAbzuege ? Math.abs(S.nettoAbzuege.value) : 0;
    const expected = [r2(S.netto.value - adj), r2(S.netto.value + adj)].sort((a, b) => Math.abs(a - S.auszahlung!.value) - Math.abs(b - S.auszahlung!.value))[0]!;
    check("payout", S.nettoAbzuege ? "Net ± other net items vs. payout" : "Net vs. payout (no other net items found)", expected, S.auszahlung);
  }
  out.quality = assessQuality(out);
  return out;
}

const SALARY_LABEL = /gehalt|monatslohn|monatsentgelt|festbezug|fixum/i;

/** the month value on a grid row: not in a year-to-date column, preferably in the amount column */
function monthNumber(l: TextLine, h: Header): Token | undefined {
  const numeric = h.cols.filter((c) => !["code", "label", "flag"].includes(c.kind));
  const colOf = (t: Token) =>
    [...numeric].sort((a, b) => Math.abs(t.x + t.w - a.right) - Math.abs(t.x + t.w - b.right))[0];
  const nums = l.tokens.filter((t) => tokNum(t.s) !== null && t.x + t.w / 2 >= h.labelEnd && colOf(t)?.kind !== "ytd");
  return nums.find((t) => colOf(t)?.kind === "amount") ?? nums[0];
}

/** One overall verdict for the import, from the cross-checks and what was found. */
export function assessQuality(p: ParsedPayslip): ImportQuality {
  const reasons: string[] = [];
  const S = p.summary;
  reasons.push(p.profile.id === "generic" ? "No known layout recognised: generic parser used" : `Recognised layout: ${p.profile.name}${p.profile.checked ? "" : " (not yet checked against a real payslip)"}`);
  reasons.push(p.payType === "salary" ? "Monthly salary: only the totals can be compared" : "Hourly wage");
  const failed = p.checks.filter((c) => !c.ok);
  for (const c of p.checks) reasons.push(`${c.label}: ${c.ok ? "ok" : "does not add up"}`);
  if (!S.gesamtbrutto) reasons.push("No gross total found");
  if (p.unmatched.length) reasons.push(`${p.unmatched.length} line(s) not recognised`);
  if (p.ytd.length) reasons.push("Year-to-date values found and ignored");
  if (p.ignored.length) reasons.push(`${p.ignored.length} Σ / repeat row(s) ignored`);
  const confirmed = p.checks.some((c) => (c.id === "gross" || c.id === "net") && c.ok);
  if (S.gesamtbrutto && S.gesamtbrutto.confidence !== "sicher") reasons.push(`Gross total: ${S.gesamtbrutto.note ?? "needs checking"}`);
  const grossCap = S.gesamtbrutto && S.gesamtbrutto.confidence !== "sicher";
  const raw: Confidence = !S.gesamtbrutto
    ? confirmed && failed.length === 0
      ? "pruefen"
      : "unsicher"
    : failed.length === 0 && confirmed
      ? "sicher"
      : failed.length <= 1
        ? "pruefen"
        : "unsicher";
  const level: Confidence = raw === "sicher" && grossCap ? "pruefen" : raw;
  return { level, reasons };
}

/** Fields found, for "did we recognise a payslip at all?" */
export function foundCount(p: ParsedPayslip): number {
  return p.rows.length + Object.keys(p.summary).length;
}
