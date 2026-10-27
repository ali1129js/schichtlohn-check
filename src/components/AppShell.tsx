import type { ReactNode } from "react";
import { useData } from "@/state/DataContext";
import { ThemeButton } from "./ThemePicker";

export type Tab = "shifts" | "pay" | "payslip" | "settings" | "data";
export const TABS: { id: Tab; label: string }[] = [
  { id: "shifts", label: "Shifts" },
  { id: "pay", label: "Pay" },
  { id: "payslip", label: "Payslip" },
  { id: "settings", label: "Settings" },
  { id: "data", label: "Data & sources" },
];

export function PrivacyNote() {
  return (
    <p className="privacy-note" role="note">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M6 10V8a6 6 0 1 1 12 0v2h1v11H5V10zm2 0h8V8a4 4 0 1 0-8 0z" fill="currentColor" />
      </svg>
      <span>
        <strong>Your data never leaves this device.</strong> Everything is stored in this browser only; there is no server and no upload.
      </span>
    </p>
  );
}

export function AppShell({ tab, onTab, children }: { tab: Tab; onTab: (t: Tab) => void; children: ReactNode }) {
  const { loadError, saveError } = useData();
  return (
    <div>
      <header className="topbar">
        <div className="topbar__inner">
          <a href="#shifts" className="brand" onClick={() => onTab("shifts")}>
            Schichtlohn-Check
            <small>Zeitarbeit · Chemie/Pharma · gross pay check</small>
          </a>
          <span className="spacer" />
          <ThemeButton />
        </div>
        <nav className="nav" aria-label="Main navigation">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => onTab(t.id)}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="accent-rule" />
      </header>
      {loadError && (
        <div role="alert" className="alert" style={{ margin: 14 }}>
          <strong>Saved data could not be read</strong> ({loadError.reason}). It was kept unchanged as a backup under <code>{loadError.backupKey}</code>{" "}
          in this browser. Starting with empty data.
        </div>
      )}
      {saveError && (
        <div role="alert" className="alert" style={{ margin: 14 }}>
          <strong>Could not save:</strong> {saveError}
        </div>
      )}
      <main className="page">{children}</main>
      <footer className="footer">
        <PrivacyNote />
        <p>Gross pay only: no tax, social insurance or net calculation. Not legal or tax advice; check your contract and payslip.</p>
      </footer>
    </div>
  );
}
