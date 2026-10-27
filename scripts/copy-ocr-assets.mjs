// Copies the OCR engine into public/ocr/ so it is served from the app's own origin (no CDN):
// tesseract.js worker, the LSTM wasm cores (the browser picks one) and German language data.
// Runs before dev and build; public/ocr/ is not committed.
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dir = (pkg) => path.dirname(require.resolve(`${pkg}/package.json`));
const out = "public/ocr";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/core`, { recursive: true });
mkdirSync(`${out}/lang`, { recursive: true });
const copy = (from, to) => {
  cpSync(from, to);
  return statSync(to).size;
};
let total = copy(path.join(dir("tesseract.js"), "dist/worker.min.js"), `${out}/worker.min.js`);
let core = 0;
for (const v of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) core = Math.max(core, copy(path.join(dir("tesseract.js-core"), `tesseract-core-${v}.wasm.js`), `${out}/core/tesseract-core-${v}.wasm.js`));
total += core + copy(path.join(dir("@tesseract.js-data/deu"), "4.0.0_best_int/deu.traineddata.gz"), `${out}/lang/deu.traineddata.gz`);
console.log(`OCR assets copied to ${out} (first use downloads about ${(total / 1e6).toFixed(1)} MB)`);
