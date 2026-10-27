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

2. **Fixture** in `tests/fixtures/synthetic.ts`: a function returning pdf.js-like text items for a
   made-up person (never real data; the leak guard runs before every test).

3. **Test** in `tests/layouts.test.ts`: assert profile detection, the main lines, the totals and the
   cross-check.

Run `npm test && npm run build`.
