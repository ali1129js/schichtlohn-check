# Updating rates

All tariff and tax values are data, validated with zod when the app loads. A wrong file fails the
tests and the build instead of silently producing numbers.

| File | Contents |
|---|---|
| `src/rules/tariffs.json` | ETV DGB/GVP hourly tables (one entry per valid-from date), TV BZ Chemie steps |
| `src/rules/s3b.json` | § 3b EStG tax-free caps and the Grundlohn cap |
| `src/rules/holidays.json` | Public holidays per state (fixed dates and Easter offsets) |

Each table carries `source` (where the value comes from), `asOf` (date checked) and `verified`
(`false` shows an "unconfirmed" badge in the UI).

To add a new ETV table: append an entry with its `validFrom` date; the app picks the table valid
for each shift date. Do not edit old tables, so past months still compute as they were paid.

Then: `npm test`, bump `version` in `package.json`, add a line to `CHANGELOG.md`, deploy.
Stored user data is not touched; if the stored data shape changes, raise `SCHEMA_VERSION` in
`src/lib/model.ts` and add a migration to `MIGRATIONS` in `src/lib/storage.ts` (never wipe data).
