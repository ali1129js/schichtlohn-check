# OCR

- Per page: the PDF text layer is used when `textLayerQuality` (`src/ocr/quality.ts`) finds it sane;
  otherwise the page is rendered (`dpi` in `src/ocr/ocr-config.json`) and recognised.
- Images (JPG/PNG/WebP, HEIC where the browser decodes it) always go through OCR.
- Preprocessing (greyscale, Otsu threshold, max image side) and reliability thresholds are in
  `src/ocr/ocr-config.json`.
- Engines live in `src/ocr/engines/*` and implement `OcrEngine` (`src/ocr/types.ts`):
  `available(cfg, env)` and `create(cfg, onProgress)` returning an `OcrSession` that produces
  word boxes with confidence. `engines.order` sets the preference; unavailable engines are skipped,
  a failing engine falls back to the next.
- Tesseract assets (worker, LSTM cores, `deu` traineddata) are copied from `node_modules` to
  `public/ocr/` by `scripts/copy-ocr-assets.mjs` (not committed) and served from this site only.
- Reliability: OCR values become at best "prüfen" (word confidence ≥ threshold), otherwise
  "unsicher"; never "sicher".
