import type { OcrConfig } from "./config";

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Otsu's threshold on a 256-bin histogram of gray values. */
export function otsu(gray: Uint8Array | Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0,
    wB = 0,
    best = 0,
    t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

/**
 * Evens out the lighting of a phone photo: every pixel is divided by its local background (a box
 * blur over a window of ~1/25 of the image side, computed with a summed-area table), so a page
 * that is bright on one side and in shadow on the other reads like a flat scan. In place.
 */
export function flattenIllumination(gray: Uint8Array | Uint8ClampedArray, width: number, height: number, radius = Math.max(8, Math.round(Math.max(width, height) / 50))): void {
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      sat[(y + 1) * w1 + x + 1] = sat[y * w1 + x + 1]! + row;
    }
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const s = sat[y1 * w1 + x1]! - sat[y0 * w1 + x1]! - sat[y1 * w1 + x0]! + sat[y0 * w1 + x0]!;
      const bg = s / ((x1 - x0) * (y1 - y0)) + 1;
      const i = y * width + x;
      gray[i] = Math.min(255, Math.round((gray[i]! / bg) * 235));
    }
  }
}

/**
 * Grayscale + threshold in place on RGBA pixels (canvas ImageData). Returns the threshold used.
 * Photos (kind "photo") use the `photos` settings: lighting evened out first, and by default no
 * global threshold, which would black out a shadowed part of the page.
 */
export function preprocess(px: Pixels, cfg: OcrConfig["preprocess"], kind: "page" | "photo" = "page"): number | null {
  const n = px.width * px.height;
  const d = px.data;
  const photo = kind === "photo" && cfg.photos ? cfg.photos : null;
  const threshold = photo ? photo.threshold : cfg.threshold;
  if (!cfg.grayscale && threshold === "none" && !photo?.flatten) return null;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = Math.round(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!);
  if (photo?.flatten) flattenIllumination(gray, px.width, px.height);
  const t = threshold === "none" ? null : threshold === "otsu" ? otsu(gray) : threshold;
  for (let i = 0; i < n; i++) {
    const v = t === null ? gray[i]! : gray[i]! > t ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  return t;
}
