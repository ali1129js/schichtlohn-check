import type { PdfPage, TextLine } from "@/import/pdfText";
import type { EngineId, OcrConfig } from "./config";

export interface OcrProgress {
  stage: "loading" | "rendering" | "recognizing";
  /** 0..1 within the stage */
  progress: number;
  page?: number;
  engine?: EngineId;
}

/**
 * Output contract, the same for every engine: text lines whose words carry their position and a
 * confidence 0-100 (Token.c), every line tagged `ocr: true`. The parser and the reliability
 * rules (OCR values are never "sicher") then treat all engines alike.
 */
export interface OcrSession {
  engine: { id: EngineId; name: string };
  recognizePdfPage(page: PdfPage, pageNo: number): Promise<TextLine[]>;
  recognizeImage(bytes: Uint8Array, mime: string): Promise<TextLine[]>;
  terminate(): Promise<void>;
}

/** What the device offers and what the user agreed to. */
export interface OcrEnv {
  webgpu: boolean;
  /** engines whose large download the user explicitly accepted */
  optIn: Partial<Record<EngineId, boolean>>;
}

export interface OcrEngine {
  id: EngineId;
  /** can it run here, now? (enabled in the config, device capabilities, opt-in) */
  available(cfg: OcrConfig, env: OcrEnv): { ok: true } | { ok: false; reason: string };
  create(cfg: OcrConfig, onProgress?: (p: OcrProgress) => void): Promise<OcrSession>;
}
