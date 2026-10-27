import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { browserKV } from "@/lib/storage";
import { applyTheme, loadTheme, resolveTheme, saveTheme, type Theme } from "@/lib/theme";

interface Ctx {
  theme: Theme;
  /** true when the user picked a theme; false while following the system setting */
  chosen: boolean;
  setTheme: (t: Theme) => void;
}
const ThemeCtx = createContext<Ctx | null>(null);
const DARK_QUERY = "(prefers-color-scheme: dark)";
const prefersDark = () => typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const kv = useMemo(() => browserKV(), []);
  const [stored, setStored] = useState<Theme | null>(() => loadTheme(kv));
  const [sysDark, setSysDark] = useState(prefersDark);
  const theme = resolveTheme(stored, sysDark);

  useEffect(() => applyTheme(document, theme), [theme]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(DARK_QUERY);
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      saveTheme(kv, t);
      setStored(t);
    },
    [kv]
  );
  const value = useMemo(() => ({ theme, chosen: stored !== null, setTheme }), [theme, stored, setTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
