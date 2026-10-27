import { z } from "zod";

/** A regular expression stored as text in a JSON data file (always case-insensitive). */
export const Pattern = z.string().min(1).refine((s) => {
  try {
    new RegExp(s, "i");
    return true;
  } catch {
    return false;
  }
}, "invalid regular expression");

const Meta = {
  schemaVersion: z.literal(1),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  verified: z.boolean(),
  note: z.string().optional(),
};

export const COLUMN_KINDS = ["code", "label", "cost", "days", "qty", "rate", "zuab", "flag", "taxable", "svable", "amount"] as const;
export const TOTAL_FIELDS = ["gesamtbrutto", "steuerbrutto", "svbrutto", "steuerfrei", "netto", "auszahlung", "azkSaldo", "gesStunden", "stundenlohn"] as const;

export const CategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  line: z.enum(["grundlohn", "branchenzuschlag", "mehrarbeit", "nacht", "sonntag", "feiertag", "tarifurlaub", "freizeit", "fahrgeld"]).optional(),
  quantity: z.enum(["hours", "units"]),
  gross: z.boolean(),
  match: Pattern.optional(),
  exclude: Pattern.optional(),
});

export const SynonymsSchema = z.object({ ...Meta, categories: z.array(CategorySchema).min(1) });

/**
 * One payslip layout (payroll program). Everything here is data: a new layout needs a new
 * file in src/parser/profiles/, a synthetic fixture and a test, but no parser code.
 */
export const ProfileSchema = z.object({
  ...Meta,
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** checked against a real payslip of this program */
  checked: z.boolean(),
  /** text markers that identify the program; score >= 4 selects the profile */
  markers: z.array(z.object({ pattern: Pattern, flags: z.string().optional(), weight: z.number().int().min(1).max(20) })).min(1),
  /** extra column-header words of this layout, per column kind (exact words, case-insensitive) */
  headers: z.partialRecord(z.enum(COLUMN_KINDS), z.array(z.string().min(1))).optional(),
  /** extra total labels (anchored patterns on the lower-cased label) */
  totals: z.partialRecord(z.enum(TOTAL_FIELDS), z.array(Pattern)).optional(),
  /** extra wage-type names: checked before the shared dictionary */
  synonyms: z.array(z.object({ category: z.string().min(1), match: Pattern })).optional(),
  /** headings that start a year-to-date block */
  ytdHeadings: z.array(Pattern).optional(),
});
export type ProfileData = z.infer<typeof ProfileSchema>;

/** Parse a data file; a broken file names itself in the error instead of failing silently. */
export function loadData<T>(schema: z.ZodType<T>, data: unknown, name: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid data file ${name}: ${i ? `${i.path.join(".")}: ${i.message}` : "invalid"}`);
  }
  return r.data;
}
