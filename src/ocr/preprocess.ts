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

/** Grayscale + threshold in place on RGBA pixels (canvas ImageData). Returns the threshold used. */
export function preprocess(px: Pixels, cfg: OcrConfig["preprocess"]): number | null {
  const n = px.width * px.height;
  const d = px.data;
  if (!cfg.grayscale && cfg.threshold === "none") return null;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = Math.round(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!);
  const t = cfg.threshold === "none" ? null : cfg.threshold === "otsu" ? otsu(gray) : cfg.threshold;
  for (let i = 0; i < n; i++) {
    const v = t === null ? gray[i]! : gray[i]! > t ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  return t;
}
