import { PAYSLIP_LINE_LABEL, PAYSLIP_LINES, type Payslip, type PayslipLine } from "@/lib/model";
import { isCategoryId, labelKey, type CategoryId, type LabelMap } from "./categories";
import type { Confidence, ParsedPayslip } from "./parser";

export type PreviewTarget =
  | { kind: "line"; line: PayslipLine; part: "hours" | "rate" | "amount" }
  | { kind: "summary"; field: SummaryTarget };

/** totals that are saved on the payslip (deductions, net and payout only to cross-check) */
export type SummaryTarget = "gesamtbrutto" | "steuerfrei" | "azkSaldo" | "abzuege" | "netto" | "auszahlung";

export interface PreviewField {
  id: string;
  label: string;
  /** editable value as text in German format (1.234,56) */
  text: string;
  confidence: Confidence;
  source: string;
  note?: string;
  target: PreviewTarget;
  selected: boolean;
  /** PDF text layer or OCR */
  origin: "text" | "ocr";
  ocrConfidence?: number;
}

export function formatDe(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Lenient parse of an edited value: accepts 1.234,56 / 1234,56 / 1234.56. */
export function parseEdited(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return null;
  let norm: string;
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^[+-]?\d+(,\d+)?$/.test(t)) norm = t.replace(/\./g, "").replace(",", ".");
  else if (/^[+-]?\d+(\.\d+)?$/.test(t)) norm = t;
  else return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const PART_LABEL = { hours: "hours", rate: "rate €/h", amount: "amount €" } as const;

export function buildPreview(p: ParsedPayslip): PreviewField[] {
  const out: PreviewField[] = [];
  for (const line of PAYSLIP_LINES) {
    const l = p.lines[line];
    if (!l) continue;
    for (const part of ["hours", "rate", "amount"] as const) {
      const v = l[part];
      if (v === undefined) continue;
      out.push({
        id: `${line}.${part}`,
        label: `${PAYSLIP_LINE_LABEL[line]}: ${part === "hours" && l.unit ? l.unit : PART_LABEL[part]}`,
        text: formatDe(v),
        confidence: l.confidence,
        source: l.source,
        note: l.note,
        target: { kind: "line", line, part },
        selected: l.confidence !== "unsicher",
        origin: l.origin ?? "text",
        ...(l.ocrConfidence !== undefined ? { ocrConfidence: l.ocrConfidence } : {}),
      });
    }
  }
  const S: Record<SummaryTarget, string> = {
    gesamtbrutto: "Gesamtbrutto",
    steuerfrei: "davon steuerfrei",
    azkSaldo: "AZK Saldo (h)",
    abzuege: "Gesetzliche Abzüge (as printed)",
    netto: "Netto (as printed)",
    auszahlung: "Auszahlung (as printed)",
  };
  for (const f of ["gesamtbrutto", "steuerfrei", "azkSaldo", "abzuege", "netto", "auszahlung"] as const) {
    const v = p.summary[f];
    if (!v) continue;
    out.push({
      id: f,
      label: S[f],
      text: formatDe(v.value),
      confidence: v.confidence,
      source: v.source,
      note: v.note,
      target: { kind: "summary", field: f },
      selected: v.confidence !== "unsicher",
      origin: v.origin ?? "text",
      ...(v.ocrConfidence !== undefined ? { ocrConfidence: v.ocrConfidence } : {}),
    });
  }
  return out;
}

export type ApplyResult = { ok: true; payslip: Payslip; applied: number } | { ok: false; errors: string[] };

/** Apply the selected (possibly edited) values onto a payslip. Unselected fields stay as they were. */
export function applyPreview(fields: PreviewField[], base: Payslip, payType?: Payslip["payType"]): ApplyResult {
  const errors: string[] = [];
  const next: Payslip = { ...base, lines: { ...base.lines }, ...(payType ? { payType } : {}) };
  let applied = 0;
  for (const f of fields) {
    if (!f.selected) continue;
    const v = parseEdited(f.text);
    if (v === null) {
      errors.push(`${f.label}: "${f.text}" is not a number`);
      continue;
    }
    if (f.target.kind === "line") {
      next.lines[f.target.line] = { ...next.lines[f.target.line], [f.target.part]: v };
    } else next[f.target.field] = v;
    applied++;
  }
  return errors.length ? { ok: false, errors } : { ok: true, payslip: next, applied };
}

/** A payslip row the app does not calculate (info only) or did not recognise. */
export interface OtherRow {
  key: string;
  label: string;
  category: CategoryId;
  by: "user" | "dictionary" | "none";
  hours?: number;
  amount?: number;
  source: string;
  origin: "text" | "ocr";
  /** keep it on the saved payslip (shown as an info row on the compare page) */
  keep: boolean;
}

export function buildOther(p: ParsedPayslip): OtherRow[] {
  return p.other.map((r, i) => ({
    key: `${i}:${labelKey(r.label)}`,
    label: r.label,
    category: r.category,
    by: r.by,
    ...(r.hours !== undefined ? { hours: r.hours } : {}),
    ...(r.amount !== undefined ? { amount: r.amount } : {}),
    source: r.source,
    origin: r.origin ?? "text",
    keep: r.amount !== undefined && r.origin !== "ocr",
  }));
}

/** Store the kept "other" rows on the payslip (replaces earlier imported ones). */
export function applyOther(p: Payslip, rows: OtherRow[]): Payslip {
  const other = rows
    .filter((r) => r.keep)
    .slice(0, 100)
    .map((r) => ({ label: r.label.slice(0, 200), category: r.category, ...(r.hours !== undefined ? { hours: r.hours } : {}), ...(r.amount !== undefined ? { amount: r.amount } : {}) }));
  const { other: _old, ...rest } = p;
  return other.length ? { ...rest, other } : rest;
}

/** Remember the user's category choice for a label; returns a new map (zod-safe strings only). */
export function rememberLabel(map: LabelMap, label: string, category: CategoryId): LabelMap {
  const k = labelKey(label).slice(0, 200);
  return { ...map, [k]: category };
}

export function toLabelMap(m: Record<string, string>): LabelMap {
  const out: LabelMap = {};
  for (const [k, v] of Object.entries(m)) if (isCategoryId(v)) out[k] = v;
  return out;
}
