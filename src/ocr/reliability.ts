import type { TextLine } from "@/import/pdfText";
import type { Confidence, ParsedPayslip } from "@/import/parser";
import type { OcrConfig } from "./config";

export type Origin = "text" | "ocr";

/**
 * OCR values are never "sicher": a value read by text recognition is at best "prüfen"
 * (word confidence >= the configured minimum and the parser itself was sure), else "unsicher".
 */
export function ocrLevel(parser: Confidence, wordConfidence: number | null, cfg: OcrConfig["reliability"]): Confidence {
  if (parser === "unsicher" || wordConfidence === null || wordConfidence < cfg.pruefenMinConfidence) return "unsicher";
  return "pruefen";
}

/** lowest confidence of the number words of a line (numbers matter most), else of all words */
function lineConfidence(l: TextLine): number | null {
  const nums = l.tokens.filter((t) => /\d/.test(t.s) && t.c !== undefined);
  const use = nums.length ? nums : l.tokens.filter((t) => t.c !== undefined);
  return use.length ? Math.min(...use.map((t) => t.c!)) : null;
}

interface Marked {
  confidence: Confidence;
  source: string;
  note?: string;
  origin?: Origin;
  ocrConfidence?: number;
}

/** Mark every parsed value with its origin (Text / OCR) and downgrade OCR values. */
export function applyOcrReliability(p: ParsedPayslip, lines: TextLine[], cfg: OcrConfig["reliability"]): ParsedPayslip {
  const ocrLines = new Map<string, number | null>();
  for (const l of lines) if (l.ocr) ocrLines.set(l.text, lineConfidence(l));
  if (!ocrLines.size) return p;
  const mark = <T extends Marked>(v: T): T => {
    const parts = v.source.split("\n");
    const hits = parts.filter((s) => ocrLines.has(s));
    if (!hits.length) return { ...v, origin: "text" };
    const confs = hits.map((s) => ocrLines.get(s) ?? null);
    const conf = confs.some((c) => c === null) ? null : Math.min(...(confs as number[]));
    const confidence = ocrLevel(v.confidence, conf, cfg);
    const note = [v.note, `read by OCR${conf !== null ? ` (word confidence ${conf} %)` : ""}: check against your payslip`].filter(Boolean).join("; ");
    return { ...v, origin: "ocr", ...(conf !== null ? { ocrConfidence: conf } : {}), confidence, note };
  };
  const lines2: ParsedPayslip["lines"] = {};
  for (const [k, v] of Object.entries(p.lines)) if (v) lines2[k as keyof ParsedPayslip["lines"]] = mark(v);
  const summary: ParsedPayslip["summary"] = {};
  for (const [k, v] of Object.entries(p.summary)) if (v) summary[k as keyof ParsedPayslip["summary"]] = mark(v);
  return {
    ...p,
    ...(p.month ? { month: mark(p.month) } : {}),
    lines: lines2,
    summary,
    rows: p.rows.map(mark),
    other: p.other.map(mark),
    // a reading by OCR is never "sicher" as a whole either
    quality: {
      level: p.quality.level === "sicher" ? "pruefen" : p.quality.level,
      reasons: [...p.quality.reasons, "Read by OCR (text recognition): compare the values with your payslip"],
    },
  };
}
