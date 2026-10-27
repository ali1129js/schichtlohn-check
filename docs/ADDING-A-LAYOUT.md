# Adding a payslip layout

A new layout needs three files and no code change:

1. **Profile** `src/parser/profiles/<id>.json` (validated by `ProfileSchema` in `src/parser/schema.ts`).
   It is picked up automatically (`import.meta.glob` in `src/parser/index.ts`).

   ```json
   {
     "schemaVersion": 1,
     "id": "example",
     "name": "Example Payroll",
     "checked": false,
     "verified": false,
     "asOf": "2026-10-27",
     "source": "Where the layout knowledge comes from",
     "note": "Shown in the import panel",
     "markers": [{ "pattern": "example\\s+payroll", "flags": "i", "weight": 10 }],
     "headers": { "qty": ["Menge"], "rate": ["Faktor"], "amount": ["Betrag"] },
     "totals": { "gesamtbrutto": ["^gesamt\\s*-?\\s*brutto$"] },
     "synonyms": [{ "category": "base", "match": "^std\\.?\\s*-?\\s*lohn" }],
     "ytdHeadings": ["^jahres\\s*-?\\s*werte"]
   }
   ```

   - `markers`: weighted patterns that identify the layout in the page text (highest score wins).
   - `headers`: exact column header words per column kind (see `COLUMN_KINDS`).
   - `totals`: label patterns per total field (see `TOTAL_FIELDS`).
   - `synonyms`: extra label → category rules, tried before `src/parser/synonyms.json`.
   - `ytdHeadings`: patterns for headings of year-to-date blocks that must not be read as monthly values.
   - `checked`: set `true` only after the profile was confirmed against a real payslip.
   - Column kinds include `ytd` (a Jahressummen / year-to-date column): its numbers are listed
     under "year-to-date" and never used as month values.

   Profiles shipped: `zvoove`, `datev`, `landwehr`, `lexware-lohn-gehalt` (footer "Lohn+Gehalt pro",
   "Abrechnung der Brutto-Netto-Bezüge") and `lohn-gehaltsabrechnung-mmyyyy` ("Lohn- und
   Gehaltsabrechnung MM.YYYY" with a Jahressummen column). Only `zvoove` is `checked`.

2. **Fixture** in `tests/fixtures/synthetic.ts`: a function returning pdf.js-like text items for a
   made-up person (never real data; the leak guard runs before every test).

3. **Test** in `tests/layouts.test.ts`: assert profile detection, the main lines, the totals and the
   cross-check.

Run `npm test && npm run build`.

## What the parser already handles (no profile entry needed)

- **Detection**: every profile is scored against the page text; the highest score at or above
  `MIN_PROFILE_SCORE` (4) wins, else the generic rules are used. Unknown lines are kept and shown.
- **Header normalisation**: header words are compared case-insensitively, with OCR border noise
  trimmed (`|`, `_`, leading quotes, dots or dashes). A trailing `*` is ignored (`St*`, `SV*`).
- **Two-line headers**: a header word ending in `-` or `/` is joined with the word directly below
  (`Lohn-` + `art` → `Lohnart`, `Stunden/` + `Einheit` → `Stunden/Einheit`).
- **Month**: month names, `MM/YYYY` and `MM.YYYY` next to "Abrechnung".
- **Year-to-date**: a `ytd` column, a `ytdHeadings` block below a heading, and a block on the *left*
  of the same lines (e.g. "Aufgelaufene Jahreswerte" with the month totals in a right column).
  A total followed by a second number (month and year) takes the one in the amount column.
- **Σ / Gesamtsumme rows** are listed as ignored. Only when no gross total is printed at all,
  the single amount of the Σ row right below the wage table becomes the gross, marked "check".
- **Value below the label**: grid labels (Steuer / SV) and right-column totals take the number
  in the same column on the next lines.
- **Monat | Jahr blocks**: values under "Jahr" are year-to-date.
- **Pay type**: a base line with hours and a rate is hourly; a "Gehalt" line without hours is a
  monthly salary. Salary payslips compare totals only (rows vs. gross, gross − deductions vs. net).
- **100 % holiday rule**: a paid public holiday ("Feiertagsstunden 100 %") is paid holiday at the
  normal rate, not a +100 % surcharge; a real "Feiertagszuschlag" stays a surcharge.
- **Checks**: rows vs. gross, taxable / SV columns, tax-free rows, gross − statutory deductions vs.
  net (table rows when no gross is printed), net ± other net items vs. payout. The overall rating
  (reads cleanly / check / uncertain) comes from these; OCR values are never better than "check".

