import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { memoryKV } from "@/lib/storage";
import {
  MOTION_KEY,
  THEME_COLOR,
  THEME_KEY,
  THEMES,
  applyMotion,
  effectiveMotion,
  loadMotion,
  loadTheme,
  resolveTheme,
  saveMotion,
  saveTheme,
  type Theme,
} from "@/lib/theme";

describe("theme storage", () => {
  it("returns null when nothing is stored", () => {
    expect(loadTheme(memoryKV())).toBeNull();
  });
  it.each(THEMES.map((t) => t.id))("round-trips %s", (t) => {
    const kv = memoryKV();
    saveTheme(kv, t);
    expect(kv.getItem(THEME_KEY)).toBe(JSON.stringify(t));
    expect(loadTheme(kv)).toBe(t);
  });
  it.each([
    ["light", "khaki"],
    ["dark-blue", "midnight"],
    ["dark-grey", "graphite"],
  ] as const)("migrates stored %s to %s", (legacy, want) => {
    const kv = memoryKV();
    kv.setItem(THEME_KEY, JSON.stringify(legacy));
    expect(loadTheme(kv)).toBe(want);
  });
  it.each([
    ["broken JSON", "{nope"],
    ["unknown theme", JSON.stringify("purple")],
    ["wrong type", "42"],
    ["bare string", "dark-blue"],
  ])("ignores %s", (_, raw) => {
    const kv = memoryKV();
    kv.setItem(THEME_KEY, raw);
    expect(loadTheme(kv)).toBeNull();
  });
  it("refuses to save an invalid theme", () => {
    expect(() => saveTheme(memoryKV(), "purple" as Theme)).toThrow();
  });
});

describe("theme default", () => {
  it("follows the system: light -> khaki, dark -> graphite", () => {
    expect(resolveTheme(null, false)).toBe("khaki");
    expect(resolveTheme(null, true)).toBe("graphite");
  });
  it("a stored choice beats the system setting", () => {
    expect(resolveTheme("midnight", false)).toBe("midnight");
    expect(resolveTheme("khaki", true)).toBe("khaki");
  });
  it("an invalid stored value falls back to the system default", () => {
    const kv = memoryKV();
    kv.setItem(THEME_KEY, JSON.stringify("sepia"));
    expect(resolveTheme(loadTheme(kv), true)).toBe("graphite");
  });
});

describe("motion preference", () => {
  it("defaults to static and only stores animated when chosen", () => {
    const kv = memoryKV();
    expect(loadMotion(kv)).toBe("static");
    saveMotion(kv, "animated");
    expect(kv.getItem(MOTION_KEY)).toBe("animated");
    expect(loadMotion(kv)).toBe("animated");
    saveMotion(kv, "static");
    expect(loadMotion(kv)).toBe("static");
  });
  it("treats unknown values as static", () => {
    const kv = memoryKV();
    kv.setItem(MOTION_KEY, "spin");
    expect(loadMotion(kv)).toBe("static");
  });
  it("forces static when the user prefers reduced motion", () => {
    expect(effectiveMotion("animated", true)).toBe("static");
    expect(effectiveMotion("animated", false)).toBe("animated");
    expect(effectiveMotion("static", false)).toBe("static");
  });
  it("writes data-motion on the document", () => {
    const root = { dataset: {} as Record<string, string> };
    const doc = { documentElement: root } as unknown as Document;
    applyMotion(doc, "animated", false);
    expect(root.dataset.motion).toBe("animated");
    applyMotion(doc, "animated", true);
    expect(root.dataset.motion).toBe("static");
  });
});

describe("no-flash inline script in index.html", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const run = (stored: string | null, dark: boolean, motionStored: string | null = null, reduced = false) => {
    const attrs: Record<string, string> = {};
    const doc = {
      documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> },
      querySelector: () => ({ setAttribute: (k: string, v: string) => (attrs[k] = v) }),
    };
    const ls = {
      getItem: (k: string) => (k === THEME_KEY ? stored : k === MOTION_KEY ? motionStored : null),
    };
    const mm = (q: string) => ({
      matches: q.includes("prefers-color-scheme: dark")
        ? dark
        : q.includes("prefers-reduced-motion")
          ? reduced
          : false,
    });
    new Function("document", "localStorage", "window", "matchMedia", script)(doc, ls, { matchMedia: mm }, mm);
    return {
      theme: doc.documentElement.dataset.theme,
      color: attrs.content,
      motion: doc.documentElement.dataset.motion,
    };
  };
  it("comes before the app bundle", () => {
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
  });
  it.each([
    [null, false, "khaki"],
    [null, true, "graphite"],
    [JSON.stringify("midnight"), false, "midnight"],
    [JSON.stringify("khaki"), true, "khaki"],
    [JSON.stringify("light"), true, "khaki"],
    [JSON.stringify("dark-blue"), false, "midnight"],
    [JSON.stringify("dark-grey"), false, "graphite"],
    ["{broken", true, "graphite"],
    [JSON.stringify("purple"), false, "khaki"],
  ])("stored %s, system dark %s -> %s (same as resolveTheme)", (stored, dark, want) => {
    const r = run(stored, dark);
    expect(r.theme).toBe(want);
    expect(r.theme).toBe(resolveTheme(loadTheme({ getItem: () => stored, setItem: () => {} }), dark));
    expect(r.color).toBe(THEME_COLOR[want as Theme]);
    expect(r.motion).toBe("static");
  });
  it("applies a stored animated preference, but reduced motion wins", () => {
    expect(run(null, false, "animated", false).motion).toBe("animated");
    expect(run(null, false, "animated", true).motion).toBe("static");
  });
});

// ---- WCAG AA contrast of the CSS variables in every theme ----
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()])
  );
}
const khaki = vars(':root[data-theme="khaki"]');
const PALETTES: Record<Theme, Record<string, string>> = {
  khaki,
  graphite: { ...khaki, ...vars(':root[data-theme="graphite"]') },
  midnight: { ...khaki, ...vars(':root[data-theme="midnight"]') },
};
function lum(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
// [foreground, background, minimum]: 4.5 for text, 3 for large text / UI parts (focus ring, borders that carry meaning)
const PAIRS: [string, string, number][] = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-2", 4.5], ["muted", "bg", 4.5], ["muted", "surface", 4.5],
  ["muted", "surface-2", 4.5], ["accent", "bg", 4.5], ["accent", "surface", 4.5], ["accent", "info-soft", 4.5], ["on-accent", "accent-bg", 4.5],
  ["on-topbar", "topbar", 4.5], ["nav-fg", "topbar", 4.5], ["on-topbar", "topbar-soft", 4.5], ["on-topbar", "hero-1", 4.5], ["on-topbar", "hero-2", 4.5],
  ["hero-eyebrow", "hero-1", 4.5], ["hero-eyebrow", "hero-2", 4.5], ["kpi-strong", "surface", 4.5], ["key-fg", "surface-2", 4.5],
  ["ok", "ok-bg", 4.5], ["ok", "ok-soft", 4.5], ["ok", "surface", 4.5], ["ok", "bg", 4.5], ["on-ok", "ok-strong", 4.5],
  ["bad", "bad-bg", 4.5], ["bad", "bad-soft", 4.5], ["bad", "surface", 4.5], ["bad", "bg", 4.5], ["on-bad", "bad-strong", 4.5],
  ["info", "info-bg", 4.5], ["warn", "warn-bg", 4.5], ["text", "sel-bg", 4.5], ["text", "ok-soft", 4.5], ["text", "bad-soft", 4.5],
  ["text", "info-soft", 4.5],
  ["bad", "sel-bg", 4.5], ["ok", "sel-bg", 4.5], ["muted", "ok-soft", 4.5], ["accent", "sel-bg", 4.5],
  ["accent", "ok-soft", 4.5], ["accent", "bad-soft", 4.5],
  ["focus", "bg", 3], ["focus", "surface", 3], ["focus-on-topbar", "topbar", 3], ["focus-on-topbar", "hero-1", 3],
  ["ok-border", "surface", 3], ["bad-border", "surface", 3], ["accent", "surface", 3], ["kpi-edge", "surface", 3],
  ["control-border", "bg", 3], ["control-border", "surface", 3],
];
describe("WCAG AA contrast", () => {
  for (const [theme, pal] of Object.entries(PALETTES)) {
    it.each(PAIRS)(`${theme}: %s on %s >= %s`, (fg, bg, min) => {
      expect(pal[fg], fg).toBeDefined();
      expect(pal[bg], bg).toBeDefined();
      expect(ratio(pal[fg]!, pal[bg]!)).toBeGreaterThanOrEqual(min);
    });
  }
  it("Graphite form-control borders use #707A8A", () => {
    expect(PALETTES.graphite["control-border"]).toBe("#707a8a");
  });
  it("does not use the old navy chrome colour", () => {
    expect(css.toLowerCase()).not.toMatch(/#10384f/);
  });
});
