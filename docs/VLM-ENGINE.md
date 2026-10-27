# Document-AI engine (Granite Docling) – TODO

Status: interface stub, experimental, OFF by default. Settings has a toggle that asks for consent
and shows the download size; with the toggle on and WebGPU present the app tries this engine and,
because `create()` throws, falls back to Tesseract. Nothing is downloaded.

Model: `onnx-community/granite-docling-258M-ONNX` (transformers.js `AutoModelForVision2Seq`,
WebGPU). q4f16 files: vision encoder ~55 MB, embed tokens ~116 MB, decoder ~93 MB (≈ 264 MB);
fp16 ≈ 632 MB.

To finish it:

1. Add `@huggingface/transformers`, lazy-imported inside `src/ocr/engines/graniteDocling.ts`.
2. Self-host the model files under `public/models/granite-docling-258M/` (or an own storage on the
   same origin; check hosting limits first). Set `env.allowRemoteModels = false`,
   `env.localModelPath` to the own path, and keep the CSP at `'self'` (no CDN, no hub).
3. Render the page like the Tesseract engine, run the model, parse the DocTags output into
   words/lines with boxes, and map them to the same `OcrWord` contract (confidence: use the token
   probabilities, or a fixed low value so values stay "prüfen"/"unsicher").
4. Report download progress through `onProgress` and keep the consent prompt.
5. Tests: same contract tests as Tesseract with a mocked pipeline; CSP test stays green.
