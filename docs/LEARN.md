# Learning notes

Short explanations of the ideas this project actually uses, and why they matter. Each one points at a file.

## Tariff data is Zod JSON, not hard-coded rates

Pay rates change on published dates, and they need a source you can check. The tables for tariffs, §3b and holidays live in JSON (`src/rules/tariffs.json`, `s3b.json`, `holidays.json`) and are loaded through Zod schemas in `src/rules/defaults.ts`. Each value carries a source, an "as of" date and a `verified` flag. Unconfirmed values still load, but the UI marks them, so a typo in a rate cannot hide inside a function. See also `docs/UPDATING-RATES.md`.

## Storage migrations never wipe

Saved shifts outlive the code. `src/lib/storage.ts` stores a `schemaVersion` and runs step-by-step migrations from every older version. If the payload is corrupt, or a version has no step, the raw value is copied to a `.backup-<timestamp>` key and the app starts empty, instead of overwriting the user's data. Tests in `tests/migrations.test.ts` require a migration step for every older version and check that a bad blob is backed up.

## OCR values need an explicit "I have checked"

A scanned page can look confident and still be wrong: a 6 can be an 8, a column can be shifted, a surcharge can attach to the wrong line. The importer therefore never treats an OCR (or even a text-layer) value as already certain. The UI shows the engine, the source, the word confidence and a warning, and `src/components/PdfImport.tsx` keeps Apply disabled until the user ticks "I have checked the ticked values against my real payslip." That checkbox is the line between a suggestion and a figure the user is willing to own. See also `docs/OCR.md`.

## Money is rounded in cents

Pay figures need the same half-up rounding you see on a slip, not raw floating point. `cents()` in `src/lib/calc.ts` rounds to two decimals with a small epsilon so 2.175 becomes 2.18, not 2.17.

## Privacy can be tested

The production CSP allows only this site's own origin. `tests/csp.test.ts` fails the build if a third-party origin appears in the CSP or the OCR config, and the leak guard runs before every test and build.
