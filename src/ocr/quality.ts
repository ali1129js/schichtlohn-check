import type { TextLine } from "@/import/pdfText";
import type { OcrConfig } from "./config";

export interface TextLayerQuality {
  chars: number;
  decimals: number;
  keywords: number;
  /** share of characters that are letters, digits, spaces or usual payslip punctuation */
  cleanRatio: number;
  ok: boolean;
  reason?: string;
}

const CLEAN = /[\p{L}\p{N}\s.,:;/()%€+\-–&'"§*#=]/u;

/** Is a page's PDF text layer usable, or is it a scan (empty) / garbage (broken font encoding)? */
export function textLayerQuality(lines: TextLine[], cfg: OcrConfig["textLayer"]): TextLayerQuality {
  const text = lines.map((l) => l.text).join("\n");
  const chars = text.replace(/\s/g, "").length;
  const all = [...text];
  const clean = all.filter((c) => CLEAN.test(c)).length;
  const cleanRatio = all.length ? clean / all.length : 0;
  const decimals = (text.match(/\d,\d{2}\b/g) ?? []).length;
  const low = text.toLowerCase();
  const keywords = cfg.keywords.filter((k) => low.includes(k)).length;
  let reason: string | undefined;
  if (chars < cfg.minChars) reason = chars === 0 ? "no text layer (scan or photo)" : "almost no text";
  else if (cleanRatio < cfg.minCleanRatio) reason = "the text layer looks garbled";
  else if (decimals < cfg.minDecimalNumbers && keywords === 0) reason = "no amounts or payslip words in the text layer";
  return { chars, decimals, keywords, cleanRatio, ok: !reason, ...(reason ? { reason } : {}) };
}
