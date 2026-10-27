# Changelog

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
