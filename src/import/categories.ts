import type { PayslipLine } from "@/lib/model";
import { SYNONYMS } from "@/parser";

/**
 * Wage-type (Lohnart) dictionary, loaded from src/parser/synonyms.json. German payroll programs
 * name the same thing differently ("Normalstunden", "Grundlohn", "Tariflohn" ...). The first
 * category whose `match` hits the label (and whose `exclude` does not) wins.
 *
 * `line`: the payslip-compare field the category fills. Categories without `line` are shown as
 * "info only" (the app does not calculate them) and are never reported as a difference.
 * `quantity`: whether the quantity column means hours (Fahrgeld quantities never are).
 * `gross`: part of the gross total (deductions such as Vorschuss/VWL are not).
 */
export const CATEGORY_IDS = [
  "base",
  "bz",
  "overtime",
  "night",
  "sunday",
  "holiday",
  "vacation",
  "azkPayout",
  "travel",
  "holidayPay",
  "sick",
  "oneOff",
  "experience",
  "shiftAllowance",
  "allowance",
  "azkBooking",
  "deduction",
  "other",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  id: CategoryId;
  label: string;
  line?: PayslipLine;
  quantity: "hours" | "units";
  gross: boolean;
  match?: RegExp;
  exclude?: RegExp;
}

export function isCategoryId(s: string): s is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(s);
}

const MATCH_ORDER: Category[] = SYNONYMS.categories.map((c) => {
  if (!isCategoryId(c.id)) throw new Error(`synonyms.json: unknown category id "${c.id}"`);
  return { ...c, id: c.id, match: c.match ? new RegExp(c.match, "i") : undefined, exclude: c.exclude ? new RegExp(c.exclude, "i") : undefined };
});
for (const id of CATEGORY_IDS) if (!MATCH_ORDER.some((c) => c.id === id)) throw new Error(`synonyms.json: category "${id}" is missing`);

export const CATEGORIES: Record<CategoryId, Category> = Object.fromEntries(MATCH_ORDER.map((c) => [c.id, c])) as Record<CategoryId, Category>;

/** Normalised label used as key for the user's own mapping ("this line is my night surcharge"). */
export function labelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.:;,]+$/, "")
    .trim();
}

export type LabelMap = Record<string, CategoryId>;

/** extra names from the detected layout profile, checked before the shared dictionary */
export type ExtraSynonyms = { category: CategoryId; re: RegExp }[];

export function categorize(label: string, userMap: LabelMap = {}, extra: ExtraSynonyms = []): { id: CategoryId; by: "user" | "dictionary" | "none" } {
  const u = userMap[labelKey(label)];
  if (u && isCategoryId(u)) return { id: u, by: "user" };
  for (const e of extra) if (e.re.test(label)) return { id: e.category, by: "dictionary" };
  for (const c of MATCH_ORDER) if (c.match?.test(label) && !c.exclude?.test(label)) return { id: c.id, by: "dictionary" };
  return { id: "other", by: "none" };
}

/** categories in display order, for the "what is this line?" select */
export const CATEGORY_OPTIONS: { id: CategoryId; label: string }[] = CATEGORY_IDS.map((id) => ({ id, label: CATEGORIES[id].label }));
