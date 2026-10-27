import type { EngineId, OcrConfig } from "../config";
import type { OcrEngine, OcrEnv, OcrProgress, OcrSession } from "../types";
import { graniteDoclingEngine } from "./graniteDocling";
import { tesseractEngine } from "./tesseract";

export const ENGINES: Record<EngineId, OcrEngine> = { graniteDocling: graniteDoclingEngine, tesseract: tesseractEngine };

export function detectEnv(optIn: OcrEnv["optIn"] = {}): OcrEnv {
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as { gpu?: unknown }).gpu;
  return { webgpu: gpu, optIn };
}

/** The engines to try, in the configured order, with the reason each one was skipped. */
export function planEngines(cfg: OcrConfig, env: OcrEnv): { use: EngineId[]; skipped: { id: EngineId; reason: string }[] } {
  const use: EngineId[] = [];
  const skipped: { id: EngineId; reason: string }[] = [];
  for (const id of cfg.engines.order) {
    const a = ENGINES[id].available(cfg, env);
    if (a.ok) use.push(id);
    else skipped.push({ id, reason: a.reason });
  }
  return { use, skipped };
}

/** Start the first engine that is available and loads; later ones are the fallback. */
export async function startOcr(cfg: OcrConfig, env: OcrEnv, onProgress?: (p: OcrProgress) => void, engines: Record<EngineId, OcrEngine> = ENGINES): Promise<OcrSession> {
  const { use } = planEngines(cfg, env);
  let last: unknown = new Error("No text recognition engine is available on this device.");
  for (const id of use) {
    try {
      return await engines[id].create(cfg, onProgress);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
