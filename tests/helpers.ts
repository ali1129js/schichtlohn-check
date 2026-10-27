import { readFileSync } from "node:fs";
import { installPolyfills } from "@/import/polyfills";
import type { PdfJsLib } from "@/import/pdfText";
import { defaultSettings, type Settings, type Shift } from "@/lib/model";

export const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** Node build of pdf.js (same library the browser uses, without a real worker). */
export async function nodePdfJs(): Promise<PdfJsLib> {
  installPolyfills();
  return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsLib;
}

export function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettings("2026-10-01"), ...over };
}

let n = 0;
export function shift(date: string, start: string, end: string, breaks: Shift["breaks"] = [], kind: Shift["kind"] = "custom"): Shift {
  return { id: `s${++n}`, date, start, end, breaks, kind };
}
