import { z } from "zod";
import json from "./ocr-config.json";

/** a path relative to the app's own origin: never a third-party URL */
const OwnPath = z.string().regex(/^[\w.-]+(?:\/[\w.-]+)*\/?$/, "must be a relative path on this site");
const OwnDir = OwnPath.refine((s) => s.endsWith("/"), "must end with /");
const Threshold = z.union([z.literal("otsu"), z.literal("none"), z.number().int().min(1).max(254)]);

export const TesseractConfigSchema = z.object({
  enabled: z.boolean(),
  name: z.string().min(1),
  lang: z.string().regex(/^[a-z_]+$/),
  pageSegMode: z.number().int().min(0).max(13),
  downloadMB: z.number().positive(),
  assets: z.object({ workerPath: OwnPath, corePath: OwnDir, langPath: OwnDir }),
});

export const GraniteDoclingConfigSchema = z.object({
  enabled: z.boolean(),
  name: z.string().min(1),
  model: z.string().min(1),
  dtype: z.enum(["fp32", "fp16", "q4", "q4f16", "int8", "uint8"]),
  downloadMB: z.number().positive(),
  requiresWebGPU: z.boolean(),
  requiresOptIn: z.boolean(),
  assets: z.object({ modelPath: OwnDir }),
  note: z.string().optional(),
});

export const ENGINE_IDS = ["graniteDocling", "tesseract"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** OCR settings (data file src/ocr/ocr-config.json, validated at load). */
export const OcrConfigSchema = z.object({
  schemaVersion: z.literal(1),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  verified: z.boolean(),
  note: z.string().optional(),
  dpi: z.number().int().min(100).max(600),
  maxImageSide: z.number().int().min(800).max(10000),
  maxPages: z.number().int().min(1).max(20),
  textLayer: z.object({
    minChars: z.number().int().min(1),
    minDecimalNumbers: z.number().int().min(0),
    minCleanRatio: z.number().min(0).max(1),
    keywords: z.array(z.string().min(2)).min(1),
  }),
  preprocess: z.object({
    grayscale: z.boolean(),
    threshold: Threshold,
    /** phone photos: even out the lighting; threshold for photos (default none) */
    photos: z.object({ flatten: z.boolean(), threshold: Threshold }).optional(),
  }),
  reliability: z.object({ pruefenMinConfidence: z.number().min(0).max(100) }),
  engines: z.object({
    order: z.array(z.enum(ENGINE_IDS)).min(1),
    graniteDocling: GraniteDoclingConfigSchema,
    tesseract: TesseractConfigSchema,
  }),
});
export type OcrConfig = z.infer<typeof OcrConfigSchema>;

const r = OcrConfigSchema.safeParse(json);
if (!r.success) throw new Error(`Invalid data file src/ocr/ocr-config.json: ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`);
export const OCR_CONFIG: OcrConfig = r.data;
