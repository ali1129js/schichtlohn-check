import type { OcrEngine } from "../types";

/**
 * Preferred engine (feature flag, OFF by default): a small document vision-language model,
 * IBM Granite Docling 258M (ONNX export onnx-community/granite-docling-258M-ONNX), run in the
 * browser with transformers.js on WebGPU. Payslips never leave the device; the model files
 * (about 264 MB in q4f16) must be served from this site and are downloaded only after the
 * user agreed. Not implemented yet: see docs/VLM-ENGINE.md for the remaining steps.
 */
export const graniteDoclingEngine: OcrEngine = {
  id: "graniteDocling",
  available(cfg, env) {
    const g = cfg.engines.graniteDocling;
    if (!g.enabled) return { ok: false, reason: "feature flag off" };
    if (g.requiresWebGPU && !env.webgpu) return { ok: false, reason: "this browser has no WebGPU" };
    if (g.requiresOptIn && !env.optIn.graniteDocling) return { ok: false, reason: `the ${g.downloadMB} MB model download was not accepted` };
    return { ok: true };
  },
  async create() {
    // TODO(docs/VLM-ENGINE.md): load transformers.js + the self-hosted model, run
    // "Convert this page to docling.", map DocTags (<loc_x1><loc_y1>... cells) to TextLine
    // tokens with a confidence derived from the token probabilities.
    throw new Error("The document AI engine is not part of this build yet.");
  },
};
