import { z } from "zod";
import type { KV } from "./storage";

/**
 * Theme preference. index.html contains an inline copy of resolveTheme() so the theme is
 * applied before first paint; tests/theme.test.ts checks the two stay in sync.
 */
export const THEME_KEY = "schichtlohn.theme.v1";
export const ThemeSchema = z.enum(["light", "dark-blue", "dark-grey"]);
export type Theme = z.infer<typeof ThemeSchema>;

export const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark-blue", label: "Dark blue" },
  { id: "dark-grey", label: "Dark grey" },
];

/** Browser chrome colour (PWA theme-color) per theme: matches the top bar. */
export const THEME_COLOR: Record<Theme, string> = {
  light: "#10384f",
  "dark-blue": "#07121f",
  "dark-grey": "#181818",
};

/** Stored choice, or null if none / invalid (invalid values are ignored, not fatal). */
export function loadTheme(kv: KV): Theme | null {
  const raw = kv.getItem(THEME_KEY);
  if (!raw) return null;
  try {
    const r = ThemeSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function saveTheme(kv: KV, t: Theme): void {
  kv.setItem(THEME_KEY, JSON.stringify(ThemeSchema.parse(t)));
}

/** Stored choice wins; otherwise follow the system: dark means dark blue. */
export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? "dark-blue" : "light");
}

export function applyTheme(doc: Document, t: Theme): void {
  doc.documentElement.dataset.theme = t;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
}
