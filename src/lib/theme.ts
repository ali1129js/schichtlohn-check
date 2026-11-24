import { z } from "zod";
import type { KV } from "./storage";

/**
 * Theme preference. index.html contains an inline copy of resolveTheme()
 * (including the light / dark-blue / dark-grey migration) so the theme is
 * applied before first paint; tests/theme.test.ts checks the two stay in sync.
 */
export const THEME_KEY = "schichtlohn.theme.v1";
export const MOTION_KEY = "schichtlohn.motion.v1";

export const ThemeSchema = z.enum(["khaki", "graphite", "midnight"]);
export type Theme = z.infer<typeof ThemeSchema>;

export const MotionSchema = z.enum(["static", "animated"]);
export type Motion = z.infer<typeof MotionSchema>;

const LEGACY_THEMES: Record<string, Theme> = {
  light: "khaki",
  "dark-blue": "midnight",
  "dark-grey": "graphite",
};

export const THEMES: { id: Theme; label: string }[] = [
  { id: "khaki", label: "Khaki" },
  { id: "graphite", label: "Graphite" },
  { id: "midnight", label: "Midnight" },
];

/** Browser chrome colour (theme-color) per theme: matches the top bar. */
export const THEME_COLOR: Record<Theme, string> = {
  khaki: "#1E2329",
  graphite: "#161A20",
  midnight: "#140F1E",
};

/** Stored choice, or null if none / invalid (invalid values are ignored, not fatal). */
export function loadTheme(kv: KV): Theme | null {
  const raw = kv.getItem(THEME_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const now = ThemeSchema.safeParse(parsed);
    if (now.success) return now.data;
    const legacy = z.enum(["light", "dark-blue", "dark-grey"]).safeParse(parsed);
    return legacy.success ? LEGACY_THEMES[legacy.data]! : null;
  } catch {
    return null;
  }
}

export function saveTheme(kv: KV, t: Theme): void {
  kv.setItem(THEME_KEY, JSON.stringify(ThemeSchema.parse(t)));
}

/** Stored choice wins; otherwise follow the system: dark means Graphite. */
export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? "graphite" : "khaki");
}

export function applyTheme(doc: Document, t: Theme): void {
  doc.documentElement.dataset.theme = t;
  doc.documentElement.style.colorScheme = t === "khaki" ? "light" : "dark";
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
}

export function loadMotion(kv: KV): Motion {
  const raw = kv.getItem(MOTION_KEY);
  return raw === "animated" ? "animated" : "static";
}

export function saveMotion(kv: KV, m: Motion): void {
  kv.setItem(MOTION_KEY, MotionSchema.parse(m));
}

export function effectiveMotion(stored: Motion, reduced: boolean): Motion {
  return reduced ? "static" : stored;
}

export function applyMotion(doc: Document, stored: Motion, reduced: boolean): void {
  doc.documentElement.dataset.motion = effectiveMotion(stored, reduced);
}
