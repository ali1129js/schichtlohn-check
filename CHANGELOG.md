# Changelog

## 0.3.0 – 2026-10-27

- One automatic import: a single drop zone takes PDFs (text or scanned), JPG, PNG, WebP and HEIC.
  The file type is read from the bytes; PDF pages use their text layer, else OCR; photos go
  straight to OCR. Status steps: file type → text / OCR → layout → pay type → checks.
- HEIC: decoded by the browser itself where possible (Safari); other browsers get a clear message.
  No converter library (they need `eval`, which the CSP `'self'` does not allow).
- Layout scoring with two new data profiles (not yet checked): "Lohn+Gehalt pro" (Brutto-Netto-
  Bezüge) and "Lohn- und Gehaltsabrechnung MM.YYYY" with a Jahressummen column.
- Monthly salary detected: per-hour, Branchenzuschlag and surcharge checks are skipped, only the
  totals are compared (rows vs. gross, gross − deductions vs. net as printed). No tax calculation.
- Parser: year-to-date column kind, left-side year-to-date blocks, two-line headers, Σ /
  Gesamtsumme rows ignored (Σ used as gross only when none is printed, marked "check"), values
  below their labels, Monat | Jahr blocks, deductions / net / payout totals with cross-checks,
  100 % holiday hours read as paid holiday, more OCR number forms, overall rating with reasons.
- OCR: photos get illumination flattening instead of a global threshold; border noise becomes
  cell borders; split labels ("Steuer - Brutto") are joined.
- Storage `schemaVersion` 3 (payslips may carry pay type, deductions, net, payout); saved data is
  migrated, nothing is wiped.

## 0.2.1 – 2026-10-27

- Fix: clicking a tab crashed the app (blank page) in current Chrome, where `window.scrollTo`
  returns a Promise that React treated as an effect cleanup. Effects now use block bodies; a test
  guards against expression-bodied effects.
- Sources: MTV DGB/GVP rules now link the DGB's Manteltarifvertrag PDF; TV BZ Chemie links the
  IGBCE Leiharbeit page (step table matches) instead of a staffing agency's copy.
- zod runs jitless, so the CSP no longer reports a blocked `eval` probe in the console.

## 0.2.0 – 2026-10-27

- Payslip layouts as data: zvoove profile (confirmed against a real zvoove payslip), DATEV and
  Landwehr basic profiles, generic fallback, synonym dictionary, unknown lines with a remembered
  category, totals cross-check.
- OCR for scanned PDFs and photos: self-hosted Tesseract.js (deu), per-page text-layer check,
  progress bar and download note, OCR banner, Text/OCR source per field, engine shown, explicit
  confirmation before applying.
- Pluggable OCR engines; experimental document-AI engine (Granite Docling) behind a Settings
  toggle, off by default (stub).
- Rules as zod-validated JSON (tariffs, § 3b, holidays) with source, asOf and verified.
- Storage `schemaVersion` 2 with migrations (no data is wiped).
- CSP `'self'` only; cache headers in `vercel.json`; version in the footer; leak guard before tests
  and builds.

## 0.1.0

- Shift entry, gross pay calculation (base, Branchenzuschlag, night/Sunday/holiday, Mehrarbeit,
  § 3b tax-free part), payslip compare, in-browser PDF import, three themes.
