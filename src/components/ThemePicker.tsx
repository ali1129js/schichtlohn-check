import { useEffect, useId, useRef, useState } from "react";
import { THEMES, type Theme } from "@/lib/theme";
import { useTheme } from "@/state/ThemeContext";

const SWATCH: Record<Theme, [string, string]> = {
  light: ["#f4f7f9", "#ffffff"],
  "dark-blue": ["#0b1a2e", "#12263f"],
  "dark-grey": ["#121212", "#1e1e1e"],
};

/** Radio group of the three themes. */
export function ThemeOptions({ onPicked }: { onPicked?: () => void }) {
  const { theme, chosen, setTheme } = useTheme();
  const name = useId();
  return (
    <fieldset className="theme-options">
      <legend className="small muted">Theme{chosen ? "" : " (following your device)"}</legend>
      {THEMES.map((t) => (
        <label key={t.id} className="theme-option">
          <input
            type="radio"
            name={name}
            value={t.id}
            checked={theme === t.id}
            onChange={() => {
              setTheme(t.id);
              onPicked?.();
            }}
          />
          <span className="theme-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${SWATCH[t.id][0]} 50%, ${SWATCH[t.id][1]} 50%)` }} />
          {t.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Small header button that opens the theme options. */
export function ThemeButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="theme-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Change theme"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="theme-panel card" id={panelId}>
          <ThemeOptions onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
