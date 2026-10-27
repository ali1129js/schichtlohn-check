# Schichtlohn-Check

Shift pay checker for Zeitarbeit (temporary agency) shift workers in chemical/pharma plants.
Enter your shifts, see the gross pay they should produce (base wage, Branchenzuschlag, night/Sunday/
holiday surcharges, Mehrarbeit, § 3b tax-free part), and compare it line by line with your payslip,
typed in or imported from the payslip PDF.

- **Gross only.** No tax, social insurance or net calculation.
- **Your data never leaves this device.** Everything is kept in `localStorage` (versioned with
  `schemaVersion` and migrations; old data is migrated, never wiped). The production build ships a CSP
  that allows only this site's own origin (`connect-src 'self'`, `worker-src 'self' blob:`), and tests
  assert that no third-party origin appears in the CSP, the OCR config or `src/`.
- **Payslip import runs 100 % in the browser.** PDFs and photos/scans (PDF, JPG, PNG, WebP; HEIC where
  the browser can decode it). Per page the PDF text layer is used when it looks sane; otherwise the page
  is rendered at about 300 dpi and read with OCR.
- **Layouts are data.** `src/parser/profiles/*.json` (zvoove confirmed against a real zvoove payslip;
  DATEV and Landwehr basic coverage) plus a generic fallback and a synonym dictionary
  (`src/parser/synonyms.json`). Unknown lines are shown with a category you pick; the choice is
  remembered. Totals are cross-checked, nothing is applied automatically.
- **OCR engines are pluggable** (`src/ocr/engines/*`, chosen by `src/ocr/ocr-config.json` order plus
  capability checks, all with the same output contract):
  - **Tesseract.js (deu)**: live default, self-hosted under `/ocr/` (about 5.4 MB on first use, no CDN).
  - **Granite Docling (document AI, WebGPU)**: experimental, OFF by default, switched on only in
    Settings after a consent prompt showing the ~264 MB size. In this version it is an interface stub
    and falls back to Tesseract (see `docs/VLM-ENGINE.md`).
  OCR values are never marked "sicher": the UI shows the engine, a Text/OCR source per field, the
  word confidence, a warning banner, and requires an explicit "I have checked" before applying.
- "Try sample" loads a made-up payslip (Max Beispiel, Musterzeit Personal GmbH, Beispiel Pharma AG).
- **Holidays follow the workplace state** (all 16 Bundesländer, default Berlin), not the home address.
  Tariff rates are nationwide, with no Ost/West difference.

## Run

```bash
npm install
npm test           # leak guard + vitest
npm run typecheck
npm run dev        # http://localhost:5191
npm run build && npm run preview   # http://localhost:4191
npm run sample:pdf # regenerate the made-up sample payslip PDF + fixtures
npm run sample:scan # regenerate the synthetic scanned fixture (needs pdftoppm)
npm run guard:history # leak guard over the whole git history
```

Stack: Vite 6, React 18, strict TypeScript, zod 4, Vitest, pdfjs-dist (legacy build), tesseract.js 7.

Docs: [adding a payslip layout](docs/ADDING-A-LAYOUT.md), [updating rates](docs/UPDATING-RATES.md),
[OCR](docs/OCR.md), [document-AI engine TODO](docs/VLM-ENGINE.md), [changelog](CHANGELOG.md).

Deploy: static Vite build on Vercel. `vercel.json` sends `index.html` with `no-cache`, hashed
`/assets/*` as immutable, and the OCR files with revalidation. There is no service worker.

Leak guard: `scripts/leak-guard.mjs` runs before every test and build. `scripts/deny-public.txt` holds
only structural patterns and hashed words; exact private values are checked locally via `DENY_EXTRA`
from a list kept outside the repo.

## Where the numbers come from

Every default lives in zod-validated data files (`src/rules/tariffs.json`, `s3b.json`, `holidays.json`)
with its source, an "as of" date and `verified`; `src/rules/defaults.ts` loads them.
Values marked `verified: false` show an **unconfirmed** badge in the UI.

| Value | Status | Source |
|---|---|---|
| ETV DGB/GVP hourly tables (01.01.2026, 01.09.2026) | verified | DGB PDF of the Entgelttarifvertrag |
| ETV table from 01.04.2027 | verified (GVP website, not the DGB PDF) | personaldienstleister.de |
| 35 h week, night 23-6 h, night 25 %, Sunday 50 %, holiday 100 % (maximums), Mehrarbeit 25 % above +15 %, highest surcharge only | verified | MTV DGB/GVP §§ 3, 6 (IG Metall Tarifsammlung Leiharbeit 2026/2027) |
| § 3b EStG caps (25/40/50/125/150 %, Grundlohn max 50 €), Oster-/Pfingstsonntag = holiday (R 3b LStR), SV-free up to 25 € (§ 1 SvEV) | verified | gesetze-im-internet.de, Lohnsteuer-Handbuch 2026 |
| Branchenzuschlag Chemie steps (15/20/30/45/53/67 % …) | **unconfirmed** | TV BZ Chemie copy hosted by an agency |
| Surcharges on base + BZ, overtime on base + BZ, base pay on worked hours | **unconfirmed** | agencies handle this differently |
| Shift presets F/S/N | not tariff values | editable |

Public holidays: statewide statutory holidays for all 16 states (`src/rules/holidays.json`). Local
holidays (Augsburger Friedensfest, Fronleichnam in parts of Sachsen/Thüringen, Mariä Himmelfahrt in
Catholic Bavarian communities) are not included.

## Open questions

1. Which Entgeltgruppe, which Erfahrungszuschlag, and since when at this customer (for the BZ step)?
2. Which night, Sunday and holiday rates and which night window does your contract/customer actually use? The MTV values are maximums.
3. Are the surcharges calculated on the base rate or on base + Branchenzuschlag? The sample uses 16,68 €.
4. Is the base wage paid for worked hours or as a fixed monthly amount, with the rest going to the AZK?
5. Does your employer still use the former iGZ working-day model for the monthly hours?
6. In which state is your workplace? The default is Berlin.
7. When night and Sunday/holiday overlap, does your employer pay both or only the highest?
8. The TV BZ Chemie step timing (weeks vs months) and the cap (§ 2 (5)).

Things the made-up sample shows that differ from the tariff text: holiday 125 % (MTV max 100 %),
overtime on the base rate only, and "EG 2" (the GVP table has 2a/2b).

## Known gaps

- DATEV and Landwehr profiles are built from public examples and synthetic fixtures, not confirmed against real slips.
- Branchenzuschlag on Urlaub/holiday pay is not confirmed; the night/Sunday overlap rule is marked "likely".
- Fahrgeld quantity semantics (days vs km) differ between employers.
- OCR makes typical mistakes (lost decimal commas, misread letters); always check every value.
- The document-AI engine is a stub behind an experimental toggle.
