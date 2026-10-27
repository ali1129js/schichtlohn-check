import { PROFILE_DATA } from "@/parser";
import type { ProfileData } from "@/parser/schema";
import { isCategoryId, type ExtraSynonyms } from "./categories";

/**
 * Layout profiles: which payroll program probably produced the payslip. They are data files in
 * src/parser/profiles/*.json. The parser itself is generic (it finds the wage-type table by its
 * column headers); a profile adds marker texts, extra header words, total labels, wage-type
 * names and year-to-date headings for its program.
 */
export type ProfileId = string;

export interface Profile {
  id: ProfileId;
  name: string;
  /** checked against a real payslip of this program */
  checked: boolean;
  note: string;
  markers: { re: RegExp; weight: number }[];
  headers: Partial<Record<string, string[]>>;
  totals: Partial<Record<string, RegExp[]>>;
  synonyms: ExtraSynonyms;
  ytdHeadings: RegExp[];
}

function compile(p: ProfileData): Profile {
  return {
    id: p.id,
    name: p.name,
    checked: p.checked,
    note: p.note ?? p.source,
    markers: p.markers.map((m) => ({ re: new RegExp(m.pattern, m.flags ?? "i"), weight: m.weight })),
    headers: p.headers ?? {},
    totals: Object.fromEntries(Object.entries(p.totals ?? {}).map(([k, v]) => [k, (v ?? []).map((s) => new RegExp(s, "i"))])),
    synonyms: (p.synonyms ?? []).map((s) => {
      if (!isCategoryId(s.category)) throw new Error(`profile ${p.id}: unknown category "${s.category}"`);
      return { category: s.category, re: new RegExp(s.match, "i") };
    }),
    ytdHeadings: (p.ytdHeadings ?? []).map((s) => new RegExp(s, "i")),
  };
}

export const PROFILES: Profile[] = PROFILE_DATA.map(compile);

export const GENERIC: Profile = {
  id: "generic",
  name: "Generic layout",
  checked: false,
  note: "No known payroll program recognised: the table is read from its column headers or, without headers, from the numbers at the end of each line.",
  markers: [],
  headers: {},
  totals: {},
  synonyms: [],
  ytdHeadings: [],
};

/** `producer`: PDF metadata (Producer/Creator), optional. */
export function detectProfile(text: string, producer = ""): { profile: Profile; score: number } {
  let best = { profile: GENERIC, score: 0 };
  for (const p of PROFILES) {
    let score = 0;
    for (const m of p.markers) {
      if (m.re.test(text)) score += m.weight;
      else if (producer && m.re.test(producer)) score += Math.ceil(m.weight / 2);
    }
    if (score > best.score) best = { profile: p, score };
  }
  return best.score >= 4 ? best : { profile: GENERIC, score: best.score };
}
