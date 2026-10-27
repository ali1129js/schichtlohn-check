# Schichtlohn-Check

Shift pay checker for Zeitarbeit (temporary agency) shift workers in chemical/pharma plants.
Enter your shifts, see the gross pay they should produce (base wage, Branchenzuschlag, night/Sunday/
holiday surcharges, Mehrarbeit, § 3b tax-free part), and compare it line by line with your payslip,
typed in or imported from the payslip PDF.

- **Gross only.** No tax, social insurance or net calculation.
- **Your data never leaves this device.** Everything is kept in `localStorage`. The production build
  ships a CSP with `connect-src 'none'`, and a test scans `src/` for network APIs.
- **PDF import runs 100 % in the browser.** pdf.js is loaded lazily and the parser is rule based
  (`src/import/parser.ts`: `LINE_RULES`, `SUMMARY_RULES`, `INFO_RULES`). Scanned PDFs without text
  get a clear message (no OCR yet). "Try sample" loads a made-up payslip (Max Beispiel, Musterzeit
  Personal GmbH, Beispiel Pharma AG).
- **Holidays follow the workplace state** (all 16 Bundesländer, default Berlin), not the home address.
  Tariff rates are nationwide, with no Ost/West difference.

## Run

```bash
npm install
npm test           # vitest
npm run dev        # http://localhost:5191
npm run build && npm run preview   # http://localhost:4191
npm run sample:pdf # regenerate the made-up sample payslip PDF + fixtures
```

Stack: Vite 6, React 18, strict TypeScript, zod 4, Vitest, pdfjs-dist (legacy build).

## Where the numbers come from

Every default lives in `src/rules/defaults.ts` with its source URL, an "as of" date and `verified`.
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

Public holidays: statewide statutory holidays for all 16 states (`src/lib/holidays.ts`). Local
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
