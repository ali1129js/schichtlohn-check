import type { TextLine } from "@/import/pdfText";
import { ownAsset } from "../assets";
import type { OcrConfig } from "../config";
import { preprocess } from "../preprocess";
import type { OcrEngine, OcrProgress, OcrSession } from "../types";
import { ocrBlocksToLines, type OcrBlock } from "../words";

type Canvas = HTMLCanvasElement;
function newCanvas(w: number, h: number): Canvas {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draw a page or photo into a canvas, preprocess it and hand it to a recogniser. */
export async function renderPdfPage(p: Parameters<OcrSession["recognizePdfPage"]>[0], cfg: OcrConfig): Promise<Canvas> {
  if (!p.getViewport || !p.render) throw new Error("this PDF page cannot be rendered");
  let scale = cfg.dpi / 72;
  const vp0 = p.getViewport({ scale });
  const side = Math.max(vp0.width, vp0.height);
  if (side > cfg.maxImageSide) scale *= cfg.maxImageSide / side;
  const viewport = p.getViewport({ scale });
  const c = newCanvas(viewport.width, viewport.height);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport, canvas: c }).promise;
  return c;
}

export async function renderImage(bytes: Uint8Array, mime: string, cfg: OcrConfig): Promise<Canvas> {
  let bmp: ImageBitmap;
  try {
    // phone photos: honour the EXIF orientation
    bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { imageOrientation: "from-image" });
  } catch {
    throw new Error(/heic|heif/i.test(mime) ? "This browser cannot open HEIC photos. Please export the photo as JPG and try again." : "The image could not be opened.");
  }
  const f = Math.min(1, cfg.maxImageSide / Math.max(bmp.width, bmp.height));
  const c = newCanvas(bmp.width * f, bmp.height * f);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/**
 * Classic OCR with tesseract.js: the fallback for devices without WebGPU, or when the user
 * declines the large document-AI download. Loaded only when a scan or photo needs it. Worker,
 * wasm core and German language data are served from this site (public/ocr/).
 */
export const tesseractEngine: OcrEngine = {
  id: "tesseract",
  available: (cfg) => (cfg.engines.tesseract.enabled ? { ok: true } : { ok: false, reason: "disabled in the OCR config" }),
  create: (cfg, onProgress) => createTesseract(cfg, onProgress),
};

async function createTesseract(cfg: OcrConfig, onProgress?: (p: OcrProgress) => void): Promise<OcrSession> {
  const t = cfg.engines.tesseract;
  onProgress?.({ stage: "loading", progress: 0, engine: "tesseract" });
  const { createWorker } = await import("tesseract.js");
  let page = 0;
  const worker = await createWorker(t.lang, 1, {
    workerPath: ownAsset(t.assets.workerPath),
    corePath: ownAsset(t.assets.corePath),
    langPath: ownAsset(t.assets.langPath),
    workerBlobURL: false,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.({ stage: "recognizing", progress: m.progress, page, engine: "tesseract" });
      else onProgress?.({ stage: "loading", progress: m.progress, engine: "tesseract" });
    },
  });
  await worker.setParameters({ tessedit_pageseg_mode: String(t.pageSegMode) as never, user_defined_dpi: String(cfg.dpi), preserve_interword_spaces: "1" });

  const recognize = async (c: Canvas): Promise<TextLine[]> => {
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      preprocess(img, cfg.preprocess);
      ctx.putImageData(img, 0, 0);
    }
    const { data } = await worker.recognize(c, {}, { blocks: true });
    return ocrBlocksToLines(data.blocks as unknown as OcrBlock[]);
  };

  return {
    engine: { id: "tesseract", name: t.name },
    async recognizePdfPage(p, pageNo) {
      page = pageNo;
      onProgress?.({ stage: "rendering", progress: 0, page, engine: "tesseract" });
      return recognize(await renderPdfPage(p, cfg));
    },
    async recognizeImage(bytes, mime) {
      page = 1;
      onProgress?.({ stage: "rendering", progress: 0, page, engine: "tesseract" });
      return recognize(await renderImage(bytes, mime, cfg));
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}
