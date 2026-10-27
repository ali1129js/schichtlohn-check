import { PAYSLIP_LINE_LABEL, PAYSLIP_LINES, type Payslip, type PayslipLine } from "@/lib/model";
import type { Confidence, ParsedPayslip } from "./parser";

export type PreviewTarget =
  | { kind: "line"; line: PayslipLine; part: "hours" | "rate" | "amount" }
  | { kind: "summary"; field: "gesamtbrutto" | "steuerfrei" | "azkSaldo" };

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
      });
    }
  }
  const S = { gesamtbrutto: "Gesamtbrutto", steuerfrei: "davon steuerfrei", azkSaldo: "AZK Saldo (h)" } as const;
  for (const f of ["gesamtbrutto", "steuerfrei", "azkSaldo"] as const) {
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
    });
  }
  return out;
}

export type ApplyResult = { ok: true; payslip: Payslip; applied: number } | { ok: false; errors: string[] };

/** Apply the selected (possibly edited) values onto a payslip. Unselected fields stay as they were. */
export function applyPreview(fields: PreviewField[], base: Payslip): ApplyResult {
  const errors: string[] = [];
  const next: Payslip = { ...base, lines: { ...base.lines } };
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
